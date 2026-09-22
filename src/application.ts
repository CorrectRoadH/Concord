// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { recoverLocalState } from './recovery.js';
import { readRepositoryTestView, type RepositoryTestView } from './view-profile.js';
import { getGitStatus, type GitBaselineCache } from './git-view.js';
import { cacheStatus, clearCache, scanAnnotations } from './annotations.js';
import { codeSnippet, locateCode } from './code-commands.js';
import { scanCode } from './code.js';
import {
  addPage,
  activateMemory,
  adoptRoadmap,
  closeIssue,
  createDocument,
  decideDesign,
  checkDesign,
  formatDesign,
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
  inspectDocumentFile,
  isSourcePath,
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
import { assertCurrentRuntimeFormat, discoverRoot, git, initialize, LocalRepository } from './storage.js';
import { snapshot as parseConfigSnapshot } from './config.js';
import { adoptConstitution, amendConstitution, initializeConstitution } from './constitution.js';
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
    case 'design.format':
    case 'memory.resolve':
    case 'memory.activate':
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
    case 'constitution.initialize':
    case 'constitution.adopt':
    case 'constitution.amend':
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
  readonly path: 'concord.config.ts';
  readonly diagnostic?: { readonly error: string; readonly message: string };
} {
  const relativePath = 'concord.config.ts';
  const path = join(root, relativePath);
  try { assertCurrentRuntimeFormat(root); }
  catch (cause) {
    const error = failure(cause);
    return { project: null, configDigest: null, source: undefined, path: relativePath, diagnostic: { error: error.code, message: error.message } };
  }
  if (!existsSync(path)) return { project: null, configDigest: null, source: undefined, path: relativePath, diagnostic: { error: 'ProjectNotFound', message: 'No concord.config.ts exists; initialize this Git worktree.' } };
  let source: string;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `${relativePath} must not be a symbolic link`);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new ConcordError('InvalidFile', `${relativePath} must be a small regular file`);
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    const error = failure(cause);
    return { project: null, configDigest: null, source: undefined, path: relativePath, diagnostic: { error: error.code, message: error.message } };
  }
  try {
    const parsed = parseConfigSnapshot(relativePath, source);
    return { project: parsed.config, configDigest: parsed.digest, source, path: relativePath };
  } catch (cause) {
    const error = failure(cause);
    return { project: null, configDigest: digest(source), source, path: relativePath, diagnostic: { error: error.code, message: error.message } };
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
      pages: config.source === undefined ? [] : [{ path: config.path, body: config.source, digest: config.configDigest!, readOnly: true, reason: 'Invalid configuration must be repaired locally before Concord can reconstruct managed state.' }],
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
  return yield* withRepository(root, (repo) => Effect.gen(function*() {
    const snapshot = yield* sync('view.compileWorkspace', () => repo.snapshot(() => {
    const currentConfigSource = repo.configSnapshot.source;
    const inspected = inspectDocuments(repo);
    let cases: ReturnType<typeof scanAnnotations>;
    let codes: ReturnType<typeof scanCode>['codes'];
    let codeFiles: ReturnType<typeof scanCode>['files'];
    let edges: ReturnType<typeof buildTrace>['edges'] = [];
    let findings = [...inspected.findings];
    let diagnostics: unknown;
    try {
      const trace = buildTrace(repo, cache);
      cases = trace.annotations;
      codes = trace.codeDeclarations;
      codeFiles = trace.codeFiles;
      edges = trace.edges;
      findings = [...inspected.findings, ...trace.findings];
      diagnostics = doctor(repo, trace);
    } catch (cause) {
      cases = scanAnnotations(repo, { cache });
      const code = scanCode(repo);
      codes = code.codes;
      codeFiles = code.files;
      findings = [...inspected.findings, ...cases.findings, ...code.findings];
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
      codes,
      edges,
      findings,
      sources: [...new Map([...cases.files, ...codeFiles].map(file => [file.path, file])).values()].sort((left, right) => left.path.localeCompare(right.path)),
      evidenceIds: evidenceIds(repo),
      templates: listTemplates(),
      cache: cases.cache,
      diagnostics,
    };
    }));
    let repositoryTests: RepositoryTestView = { status: 'not-configured', tests: [] };
    const hasProfile = yield* sync('view.detectRepositoryProfile', () => lstatSync(join(root, 'concord.repository.json'), { throwIfNoEntry: false }) !== undefined);
    if (hasProfile) {
      const result = yield* Effect.result(readRepositoryTestView(root));
      if (Result.isSuccess(result)) repositoryTests = { status: 'ready', tests: result.success };
      else {
        const cause = (typeof result.failure === 'object' && result.failure !== null ? result.failure : {}) as { _tag?: string; code?: string; message?: string };
        repositoryTests = { status: 'failed', tests: [], error: { code: cause.code ?? cause._tag ?? 'RepositoryProfileReadFailed', message: cause.message ?? String(result.failure) } };
      }
    }
    return { ...snapshot, repositoryTests };
  }), { dryRun: cache === 'off' });
});

/** Git needs current configuration, not the document, code, or evidence projections. */
export const getViewGitStatus = Effect.fn('view.getViewGitStatus')(function*(rootInput: string, baselineCache?: GitBaselineCache) {
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const config = directConfig(root);
  const testRoots = config.project === null ? [] : yield* withRepository(root,
    repo => Effect.succeed(repo.config.testRoots), { dryRun: true });
  return yield* getGitStatus(root, true, baselineCache, testRoots);
});

export const getViewFile = Effect.fn('view.getViewFile')(function*(root: string, path: string): Effect.fn.Return<ViewFile, ConcordError> {
  const validatedRoot = yield* sync('view.validateRoot', () => validateViewRoot(root));
  const config = directConfig(validatedRoot);
  if (config.project === null) {
    if (path !== config.path || config.source === undefined) return yield* Effect.fail(new ConcordError('FileNotFound', 'Only the malformed project configuration diagnostic is available until configuration is repaired'));
    return { path, body: config.source, digest: config.configDigest!, readOnly: true, reason: 'Invalid configuration must be repaired locally before Concord can reconstruct managed state.' };
  }
  return yield* withRepository(validatedRoot, (repo) => Effect.gen(function*() {
    const ordinary = yield* sync('view.readFile', () => repo.snapshot(() => {
      const listed = inspectDocumentFile(repo, path);
      if (listed !== undefined) return listed;
      if (isSourcePath(repo, path)) {
        let source: ReturnType<typeof readSource>;
        try { source = readSource(repo, path); }
        catch (cause) {
          if (cause instanceof ConcordError && cause.code === 'SourceNotFound') return undefined;
          throw cause;
        }
        return { path: source.path, body: source.body, digest: source.digest, readOnly: false };
      }
      if (path === repo.configSnapshot.path) {
        return { path, body: repo.configSnapshot.source, digest: repo.configSnapshot.digest, readOnly: true, reason: 'Edit configuration through config.set so project identity and validation are preserved.' };
      }
      return undefined;
    }));
    if (ordinary !== undefined) return ordinary;

    const projected = yield* Effect.result(readRepositoryTestView(validatedRoot));
    if (Result.isSuccess(projected) && projected.success.some(test => test.file === path)) {
      return yield* sync('view.readRepositoryTestFile', () => repo.snapshot(() => {
        const body = repo.read(path);
        if (body === undefined) throw new ConcordError('FileNotFound', 'The explicitly associated project test file no longer exists');
        return { path, body, digest: digest(body), readOnly: true, reason: 'Project test source is available here for inspection only.' };
      }));
    }
    return yield* Effect.fail(new ConcordError('FileNotFound', 'The requested path is not in the Concord document, configured source, or explicitly associated project test inventory'));
  }), { dryRun: true });
});

function executeWithRepo(repo: LocalRepository, action: Exclude<ViewAction, { action: 'init' | 'recover' | 'template.show' | 'feedback.sync' }>): unknown {
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  switch (action.action) {
    case 'document.create': return createDocument(repo, action.kind, { ...action, dryRun });
    case 'document.set': return setMarkdown(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'document.metadata': return setMetadata(repo, action.reference, { title: action.title, observedAt: action.observedAt, sources: action.sources, constitutionRefs: action.constitutionRefs }, action.expectedDigest, dryRun);
    case 'page.add': return addPage(repo, action.kind, action.id, action.page, dryRun, action.plan);
    case 'roadmap.adopt': return adoptRoadmap(repo, action.id, action.feature, dryRun);
    case 'design.decide': return decideDesign(repo, action.id, action.selected, action.targets, action.reason, dryRun);
    case 'design.check': return checkDesign(repo, action.id);
    case 'design.format': return formatDesign(repo, action.id, dryRun);
    case 'memory.resolve': {
      const trace = buildTrace(repo, 'off', { includeCode: false });
      requireValidTrace(trace);
      const problem = findDocument(trace.documents, action.id, 'memory');
      if (action.kind === 'fixed' && (!action.red || !action.green)) throw new ConcordError('EvidenceRequired', 'fixed requires red and green evidence IDs');
      if (action.kind !== 'fixed' && (action.red || action.green)) throw new ConcordError('InvalidOption', 'Evidence IDs apply only to fixed resolutions');
      const proof = action.kind === 'fixed' ? verifyFixedEvidence(repo, trace.documents, trace.annotations.cases, problem, action.red!, action.green!) : undefined;
      return resolveMemory(repo, action.id, action.kind, action.reason, proof, dryRun);
    }
    case 'memory.activate': return activateMemory(repo, action.id, action.reason, dryRun);
    case 'memory.reopen': return reopenMemory(repo, action.id, action.reason, dryRun);
    case 'memory.supersede': return supersedeMemory(repo, action.id, action.replacement, action.reason, dryRun);
    case 'memory.promote': return promoteMemory(repo, action.id, action.target, dryRun);
    case 'memory.retire': return retirePromotion(repo, action.id, action.target, action.reason, dryRun);
    case 'issue.link': return linkIssue(repo, action.id, action.memory, dryRun);
    case 'issue.close': return closeIssue(repo, action.id, action.reason, dryRun);
    case 'feedback.link': return linkFeedbackFeature(repo, action.id, action.feature, dryRun);
    case 'source.set': return setSource(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'config.set': return setConfig(repo, action.config, action.expectedDigest, dryRun);
    case 'constitution.initialize': return initializeConstitution(repo, dryRun);
    case 'constitution.adopt': return adoptConstitution(repo, action.body, action.reason, action.impact, action.sources, action.expectedDigest, dryRun);
    case 'constitution.amend': return amendConstitution(repo, action.version, action.body, action.reason, action.impact, action.sources, action.expectedDigest, dryRun);
    case 'code.annotate': return codeSnippet(repo, action.scope, action.contracts);
    case 'code.locate': return locateCode(repo, action.path, action.line);
    case 'test.annotate': return annotationSnippet(repo, action.contract, action.regressions);
    case 'evidence.show': return readEvidence(repo, action.id);
    case 'cache.status': return cacheStatus(repo);
    case 'cache.clear': return dryRun ? { operation: 'cache-clear', dryRun: true } : clearCache(repo);
    case 'cache.rebuild': return scanAnnotations(repo, { cache: 'rebuild' });
    case 'check': {
      const trace = buildTrace(repo);
      return { operation: 'check', ok: trace.findings.length === 0, findings: trace.findings, advisories: trace.advisories, documents: trace.documents.length, cases: trace.annotations.cases.length, codeDeclarations: trace.codeDeclarations.length, memoryEvidence: trace.memories, cache: trace.annotations.cache };
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
    return yield* withRepository(root, (repo) => sync('view.initialize', () => repo.snapshot(() => initialize(repo, dryRun, {
      testRoots: action.docsOnly ? [] : action.testRoots,
      sourceRoots: action.sourceRoots,
      runner: action.runner,
      projectTypes: action.projectTypes,
      pages: action.pages,
      design: action.design,
      constitutionBody: action.constitutionBody,
      adoptConstitution: action.adoptConstitution,
      constitutionReason: action.constitutionReason,
      constitutionImpact: action.constitutionImpact,
      constitutionSources: action.constitutionSources,
      memorySources: action.memorySources,
    }))), { initialize: true, dryRun });
  }
  if (action.action === 'recover') return yield* recoverLocalState(root);
  if (action.action === 'feedback.sync') return yield* syncFeedback(root, action.connection, { url: action.url, dryRun: action.dryRun });
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  return yield* withRepository(root, (repo) => sync(`view.action.${action.action}`, () => repo.snapshot(() => executeWithRepo(repo, action))), { dryRun: action.action === 'design.check' || dryRun });
});
