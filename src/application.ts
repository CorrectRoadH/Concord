// @concord-file shared-workbench-operations
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { cacheStatus, clearCache, scanAnnotations } from './annotations.js';
import { codeSnippet, locateCode } from './code-commands.js';
import { scanCode } from './code.js';
import {
  addPage,
  adoptRoadmap,
  closeIssue,
  createDocument,
  decideDesign,
  findDocument,
  linkIssue,
  linkFeedbackFeature,
  promoteMemory,
  reopenMemory,
  resolveMemory,
  retirePromotion,
  supersedeMemory,
} from './documents.js';
import { listFeedback, syncFeedback } from './feedback.js';
import {
  inspectDocuments,
  listSources,
  readSource,
  setConfig,
  setMarkdown,
  setMetadata,
  setSource,
} from './editing.js';
import { readEvidence, verifyFixedEvidence } from './evidence.js';
import { annotationSnippet, doctor } from './onboarding.js';
import { ConcordError, ProjectSchema, decode, digest, failure, type Repository } from './shared.js';
import { discoverRoot, git, initialize, LocalRepository } from './storage.js';
import { listTemplates, templateBody } from './templates.js';
import { buildTrace, renderReview, requireValidTrace, traceShow } from './trace.js';
import { ViewActionSchema, type ViewAction, type ViewFile, type WorkspaceSnapshot } from './view-contract.js';

const sync = <A>(name: string, evaluate: () => A): Effect.Effect<A, ConcordError> => Effect.try({
  try: evaluate,
  catch: failure,
}).pipe(Effect.withSpan(name));

export function validateViewRoot(input: string): string {
  const root = discoverRoot(input, true);
  if (git(root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new ConcordError('ProjectRootInvalid', 'The view root must be the Git worktree top-level directory');
  }
  return root;
}

export function decodeViewAction(input: unknown): ViewAction {
  return decode(ViewActionSchema, input, 'view action');
}

export function applyViewDryRun(input: unknown, enabled: boolean): ViewAction {
  const action = decodeViewAction(input);
  if (!enabled) return action;
  if (action.action === 'recover' || action.action === 'cache.rebuild') {
    throw new ConcordError('InvalidOption', `${action.action} does not accept --dry-run`);
  }
  switch (action.action) {
    case 'init':
    case 'document.create':
    case 'document.set':
    case 'document.metadata':
    case 'page.add':
    case 'roadmap.adopt':
    case 'design.decide':
    case 'memory.resolve':
    case 'memory.reopen':
    case 'memory.supersede':
    case 'memory.promote':
    case 'memory.retire':
    case 'issue.link':
    case 'issue.close':
    case 'feedback.sync':
    case 'feedback.link':
    case 'source.set':
    case 'config.set':
    case 'cache.clear':
      return { ...action, dryRun: true };
    default:
      return action;
  }
}

function withRepository<A>(
  root: string,
  operation: (repo: LocalRepository) => Effect.Effect<A, ConcordError>,
  options: { readonly initialize?: boolean; readonly recover?: boolean; readonly dryRun?: boolean } = {},
): Effect.Effect<A, ConcordError> {
  return Effect.acquireRelease(
    sync('view.openRepository', () => new LocalRepository(root, options)),
    (repo) => Effect.sync(() => repo.close()),
  ).pipe(Effect.flatMap(operation), Effect.scoped);
}

function evidenceIds(repo: Repository): readonly string[] {
  const directory = join(repo.privateDir, 'evidence');
  if (!existsSync(directory)) return [];
  const directoryStat = lstatSync(directory);
  if (directoryStat.isSymbolicLink()) throw new ConcordError('UnsafePath', 'The private evidence directory must not be a symbolic link');
  if (!directoryStat.isDirectory()) throw new ConcordError('InvalidEvidence', 'The private evidence path must be a directory');
  return readdirSync(directory)
    .flatMap((name) => {
      const id = /^((?:ccev_)[0-9a-f]{32})\.json$/u.exec(name)?.[1];
      if (id === undefined) return [];
      const stat = lstatSync(join(directory, name));
      if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Evidence receipt must not be a symbolic link: ${name}`);
      return stat.isFile() ? [id] : [];
    })
    .sort();
}

function directConfig(root: string): {
  readonly project: WorkspaceSnapshot['project'];
  readonly configDigest: string | null;
  readonly source: string | undefined;
  readonly diagnostic?: { readonly error: string; readonly message: string };
} {
  const path = join(root, 'concord.json');
  if (!existsSync(path)) return { project: null, configDigest: null, source: undefined, diagnostic: { error: 'ProjectNotFound', message: 'No concord.json exists; initialize this Git worktree.' } };
  let source: string;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', 'concord.json must not be a symbolic link');
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new ConcordError('InvalidFile', 'concord.json must be a small regular file');
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    const error = failure(cause);
    return { project: null, configDigest: null, source: undefined, diagnostic: { error: error.code, message: error.message } };
  }
  try {
    return { project: decode(ProjectSchema, JSON.parse(source), 'concord.json'), configDigest: digest(source), source };
  } catch (cause) {
    const error = failure(cause);
    return { project: null, configDigest: digest(source), source, diagnostic: { error: error.code, message: error.message } };
  }
}

/** Missing or malformed project configuration remains inspectable without manufacturing identity. */
export const getWorkspaceSnapshot = Effect.fn('view.getWorkspaceSnapshot')(function*(rootInput: string, cache: 'use' | 'off' = 'off'): Effect.fn.Return<WorkspaceSnapshot, ConcordError> {
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const config = directConfig(root);
  if (config.project === null) {
    return {
      root,
      project: null,
      configDigest: config.configDigest,
      documents: [],
      feedback: [],
      pages: config.source === undefined ? [] : [{ path: 'concord.json', body: config.source, digest: config.configDigest!, readOnly: true, reason: 'Invalid configuration must be repaired locally before Concord can reconstruct managed state.' }],
      cases: [],
      codes: [],
      edges: [],
      findings: [],
      sources: [],
      evidenceIds: [],
      templates: listTemplates(),
      cache: { status: 'unavailable' },
      diagnostics: config.diagnostic,
    };
  }
  return yield* withRepository(root, (repo) => sync('view.compileWorkspace', () => {
    const currentConfigSource = repo.read('concord.json');
    if (currentConfigSource === undefined) throw new ConcordError('ProjectNotFound', 'concord.json disappeared while compiling the workspace');
    const inspected = inspectDocuments(repo);
    let cases = scanAnnotations(repo, { cache });
    const code = scanCode(repo);
    let edges: ReturnType<typeof buildTrace>['edges'] = [];
    let findings = [...inspected.findings, ...cases.findings, ...code.findings];
    let diagnostics: unknown;
    try {
      const trace = buildTrace(repo, cache);
      cases = trace.annotations;
      edges = trace.edges;
      findings = [...inspected.findings, ...trace.findings];
      diagnostics = doctor(repo);
    } catch (cause) {
      const error = failure(cause);
      diagnostics = { ok: false, error: error.code, message: error.message, details: error.details };
    }
    return {
      root: repo.root,
      project: repo.config,
      configDigest: digest(currentConfigSource),
      documents: inspected.documents,
      feedback: listFeedback(repo, inspected.documents),
      pages: inspected.pages,
      cases: cases.cases,
      codes: code.codes,
      edges,
      findings,
      sources: listSources(repo),
      evidenceIds: evidenceIds(repo),
      templates: listTemplates(),
      cache: cases.cache,
      diagnostics,
    };
  }), { dryRun: cache === 'off' });
});

export const getViewFile = Effect.fn('view.getViewFile')(function*(root: string, path: string): Effect.fn.Return<ViewFile, ConcordError> {
  const validatedRoot = yield* sync('view.validateRoot', () => validateViewRoot(root));
  const config = directConfig(validatedRoot);
  if (config.project === null) {
    if (path !== 'concord.json' || config.source === undefined) return yield* Effect.fail(new ConcordError('FileNotFound', 'Only the malformed concord.json diagnostic is available until configuration is repaired'));
    return { path, body: config.source, digest: config.configDigest!, readOnly: true, reason: 'Invalid configuration must be repaired locally before Concord can reconstruct managed state.' };
  }
  return yield* withRepository(validatedRoot, (repo) => sync('view.readFile', () => {
    const inspected = inspectDocuments(repo);
    const listed = inspected.pages.find((page) => page.path === path);
    if (listed !== undefined) return listed;
    const document = inspected.documents.find((item) => item.path === path);
    if (document !== undefined) return { path, body: document.body, digest: document.digest, readOnly: false, documentPath: document.path };
    if (listSources(repo).some((item) => item.path === path)) {
      const source = readSource(repo, path);
      return { path: source.path, body: source.body, digest: source.digest, readOnly: false };
    }
    if (path === 'concord.json') {
      const body = repo.read(path);
      if (body === undefined) throw new ConcordError('FileNotFound', 'concord.json does not exist');
      return { path, body, digest: digest(body), readOnly: true, reason: 'Edit configuration through config.set so project identity and validation are preserved.' };
    }
    throw new ConcordError('FileNotFound', 'The requested path is not in the Concord document or configured source inventory');
  }));
});

function executeWithRepo(repo: LocalRepository, action: Exclude<ViewAction, { action: 'init' | 'recover' | 'template.show' | 'feedback.sync' }>): unknown {
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  switch (action.action) {
    case 'document.create': return createDocument(repo, action.kind, { ...action, dryRun });
    case 'document.set': return setMarkdown(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'document.metadata': return setMetadata(repo, action.reference, { title: action.title, observedAt: action.observedAt, sources: action.sources }, action.expectedDigest, dryRun);
    case 'page.add': return addPage(repo, action.kind, action.id, action.page, dryRun, action.plan);
    case 'roadmap.adopt': return adoptRoadmap(repo, action.id, action.feature, dryRun);
    case 'design.decide': return decideDesign(repo, action.id, action.selected, action.targets, action.reason, dryRun);
    case 'memory.resolve': {
      const trace = buildTrace(repo, 'off', { includeCode: false });
      requireValidTrace(trace);
      const problem = findDocument(trace.documents, action.id, 'memory');
      if (action.kind === 'fixed' && (!action.red || !action.green)) throw new ConcordError('EvidenceRequired', 'fixed requires red and green evidence IDs');
      if (action.kind !== 'fixed' && (action.red || action.green)) throw new ConcordError('InvalidOption', 'Evidence IDs apply only to fixed resolutions');
      const proof = action.kind === 'fixed' ? verifyFixedEvidence(repo, trace.documents, trace.annotations.cases, problem, action.red!, action.green!) : undefined;
      return resolveMemory(repo, action.id, action.kind, action.reason, proof, dryRun);
    }
    case 'memory.reopen': return reopenMemory(repo, action.id, action.reason, dryRun);
    case 'memory.supersede': return supersedeMemory(repo, action.id, action.replacement, action.reason, dryRun);
    case 'memory.promote': return promoteMemory(repo, action.id, action.target, dryRun);
    case 'memory.retire': return retirePromotion(repo, action.id, action.target, action.reason, dryRun);
    case 'issue.link': return linkIssue(repo, action.id, action.memory, dryRun);
    case 'issue.close': return closeIssue(repo, action.id, action.reason, dryRun);
    case 'feedback.link': return linkFeedbackFeature(repo, action.id, action.feature, dryRun);
    case 'source.set': return setSource(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'config.set': return setConfig(repo, action.config, action.expectedDigest, dryRun);
    case 'code.annotate': return codeSnippet(repo, action.id, action.scope, action.contracts);
    case 'code.locate': return locateCode(repo, action.path, action.line);
    case 'test.annotate': return annotationSnippet(repo, action.id, action.contract, action.regressions);
    case 'evidence.show': return readEvidence(repo, action.id);
    case 'cache.status': return cacheStatus(repo);
    case 'cache.clear': return dryRun ? { operation: 'cache-clear', dryRun: true } : clearCache(repo);
    case 'cache.rebuild': return scanAnnotations(repo, { cache: 'rebuild' });
    case 'check': {
      const trace = buildTrace(repo);
      return { operation: 'check', ok: trace.findings.length === 0, findings: trace.findings, documents: trace.documents.length, cases: trace.annotations.cases.length, codeDeclarations: trace.codeDeclarations.length, memoryEvidence: trace.memories, cache: trace.annotations.cache };
    }
    case 'trace.check': {
      const trace = buildTrace(repo);
      return { operation: 'trace-check', ok: trace.findings.length === 0, findings: trace.findings, edges: trace.edges };
    }
    case 'trace.show': return traceShow(repo, action.reference);
    case 'review.render': return { operation: 'review-render', markdown: renderReview(repo, action.reference) };
    case 'doctor': return doctor(repo);
  }
}

export const executeViewAction = Effect.fn('view.executeAction')(function*(rootInput: string, input: unknown): Effect.fn.Return<unknown, ConcordError> {
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const action = yield* sync('view.decodeAction', () => decodeViewAction(input));
  if (action.action === 'template.show') return yield* sync('view.template', () => ({ operation: 'template-show', name: action.name, body: templateBody(action.name, action.title ?? 'Your title') }));
  if (action.action === 'init') {
    if (action.docsOnly && (action.testRoots?.length ?? 0) > 0) return yield* Effect.fail(new ConcordError('ConflictingOptions', 'docsOnly cannot be combined with testRoots'));
    const dryRun = action.dryRun ?? false;
    return yield* withRepository(root, (repo) => sync('view.initialize', () => initialize(repo, dryRun, {
      testRoots: action.docsOnly ? [] : action.testRoots,
      sourceRoots: action.sourceRoots,
      runner: action.runner,
    })), { initialize: true, dryRun });
  }
  if (action.action === 'recover') return yield* withRepository(root, (repo) => sync('view.recover', () => repo.recover()), { recover: true });
  if (action.action === 'feedback.sync') return yield* syncFeedback(root, action.connection, { url: action.url, dryRun: action.dryRun });
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  return yield* withRepository(root, (repo) => sync(`view.action.${action.action}`, () => executeWithRepo(repo, action)), { dryRun });
});
