// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { recoverLocalState } from './recovery.js';
import { waitForPublication } from './publication-wait.js';
import { allowPersistentCacheRecovery } from './cache-store.js';
import { readRepositoryTestView, type RepositoryTestView } from './view-profile.js';
import { getGitStatus, type GitBaselineCache } from './git-view.js';
import { cacheStatus, clearCache, previewCacheClear, scanAnnotations } from './annotations.js';
import { codeSnippet, locateCode } from './code-commands.js';
import { scanCode } from './code.js';
import {
  addPage,
  activateMemory,
  adoptRoadmap,
  adoptIssue,
  retireIssue,
  reopenIssue,
  closeIssue,
  createDocument,
  correctDesignReason,
  decideDesign,
  checkDesign,
  formatDesign,
  findDocument,
  linkIssue,
  promoteMemory,
  reopenMemory,
  resolveMemory,
  retirePromotion,
  supersedeMemory,
} from './documents.js';
import { checkFeedbackConnection, listFeedback, syncFeedback } from './feedback.js';
import { editKnowledge, knowledgeIndex, knowledgeRecall, removeIssue } from './knowledge.js';
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
import { ConcordError, IssueClosureSchema, ProjectSchema, decode, digest, failure, type Repository } from './shared.js';
import { assertCurrentRuntimeFormat, discoverRoot, git, initialize, LocalRepository } from './storage.js';
import { snapshot as parseConfigSnapshot } from './config.js';
import { adoptConstitution, amendConstitution, initializeConstitution } from './constitution.js';
import { listTemplates, templateBody } from './templates.js';
import { buildTrace, renderReview, requireValidTrace, traceShow } from './trace.js';
import { ViewActionSchema, type ViewAction, type ViewFile, type WorkspaceSnapshot } from './view-contract.js';
import { showWriting, setWriting, writingIndex } from './writing-management.js';
import { checkWriting } from './writing.js';
import { checkProject } from './project-check.js';
import { indexConcepts, setConcepts, showConcepts } from './concepts.js';
import type { RequestTiming } from './view-request-log.js';

const sync = <A>(name: string, evaluate: () => A): Effect.Effect<A, ConcordError> => Effect.try({
  try: evaluate,
  catch: failure,
}).pipe(Effect.withSpan(name));
const measuredSync = (timing?: RequestTiming) => <A>(name: string, evaluate: () => A): Effect.Effect<A, ConcordError> =>
  sync(name, () => timing === undefined ? evaluate() : timing.sync(name, evaluate));

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
    case 'design.correct-reason':
    case 'design.format':
    case 'memory.resolve':
    case 'memory.edit':
    case 'memory.activate':
    case 'memory.reopen':
    case 'memory.supersede':
    case 'memory.promote':
    case 'memory.retire':
    case 'issue.adopt':
    case 'issue.retire':
    case 'issue.reopen':
    case 'issue.link':
    case 'issue.edit':
    case 'issue.remove':
    case 'issue.close':
    case 'feedback.sync':
    case 'feedback.link':
    case 'source.set':
    case 'writing.set':
    case 'concepts.set':
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
  options: { readonly initialize?: boolean; readonly recover?: boolean; readonly dryRun?: boolean; readonly access?: 'read' | 'write' } = {},
  timing?: RequestTiming,
): Effect.Effect<A, ConcordError> {
  return Effect.acquireRelease(
    waitForPublication(reclaimDead => measuredSync(timing)('view.openRepository', () => new LocalRepository(root, { optimistic: true, ...options, reclaimPublication: reclaimDead }))),
    (repo) => Effect.sync(() => timing === undefined ? repo.close() : timing.sync('view.closeRepository', () => repo.close())),
  ).pipe(Effect.flatMap(operation), Effect.scoped);
}

function snapshotSync<A>(repo: LocalRepository, timing: RequestTiming | undefined, name: string, evaluate: () => A): Effect.Effect<A, ConcordError> {
  return Effect.acquireUseRelease(
    waitForPublication(reclaimDead => sync(`${name}.acquire`, () => repo.beginSnapshot(reclaimDead))),
    () => measuredSync(timing)(name, () => { const value = evaluate(); repo.verifySnapshot(); return value; }),
    () => Effect.sync(() => repo.endSnapshot()),
  );
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
const compileWorkspace = Effect.fn('view.compileWorkspace')(function*(rootInput: string, cache: 'use' | 'off', timing?: RequestTiming, observe?: (drift: { files: string[]; directories: string[]; publicationChanged: boolean }) => void): Effect.fn.Return<WorkspaceSnapshot, ConcordError> {
  const sync = measuredSync(timing);
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const config = yield* sync('view.readConfig', () => directConfig(root));
  if (config.project === null) {
    return {
      root,
      project: null,
      complete: false,
      configDigest: config.configDigest,
      documents: [],
      feedback: [],
      pages: config.source === undefined ? [] : [{ path: config.path, body: config.source, digest: config.configDigest! }],
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
    const compile = () => repo.snapshot(() => {
    if (cache === 'use') allowPersistentCacheRecovery(repo);
    const currentConfigSource = repo.configSnapshot.source;
    const inspected = timing === undefined ? inspectDocuments(repo) : timing.sync('view.inspectDocuments', () => inspectDocuments(repo));
    let cases: ReturnType<typeof scanAnnotations>;
    let codes: ReturnType<typeof scanCode>['codes'];
    let codeFiles: ReturnType<typeof scanCode>['files'];
    let edges: ReturnType<typeof buildTrace>['edges'] = [];
    let findings = [...inspected.findings];
    let diagnostics: unknown;
    try {
      const compile = () => buildTrace(repo, cache, { timing, inventory: { documents: inspected.documents, findings: inspected.findings, complete: inspected.findings.length === 0 } });
      const trace = timing === undefined ? compile() : timing.sync('view.buildTrace', compile);
      timing?.cache(trace.codeCache, 'code');
      cases = trace.annotations;
      codes = trace.codeDeclarations;
      codeFiles = trace.codeFiles;
      edges = trace.edges;
      findings = [...trace.findings];
      diagnostics = doctor(repo, trace);
    } catch (cause) {
      if (observe !== undefined && cause instanceof ConcordError && ['UnsafePath', 'RecoveryRequired', 'InvalidFile'].includes(cause.code)) throw cause;
      cases = scanAnnotations(repo, { cache });
      const code = scanCode(repo, { cache });
      timing?.cache(code.cache, 'code');
      codes = code.codes;
      codeFiles = code.files;
      findings = [...inspected.findings, ...cases.findings, ...code.findings];
      const error = failure(cause);
      findings.push({ code: error.code, path: '.', message: error.message });
      diagnostics = { ok: false, error: error.code, message: error.message, details: error.details };
    }
    return {
      root: repo.root,
      complete: findings.length === 0,
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
    });
    const snapshot = yield* observe === undefined
      ? snapshotSync(repo, timing, 'view.compileWorkspace', compile)
      : sync('view.observeProjection', () => { const result = repo.observeProjection(compile); observe(result.drift); return result.value; });
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
    return { ...snapshot, complete: snapshot.complete && repositoryTests.status !== 'failed', repositoryTests };
  }), { access: 'read' }, timing);
});

export const getWorkspaceSnapshot = (root: string, cache: 'use' | 'off' = 'off', timing?: RequestTiming) => compileWorkspace(root, cache, timing);
export const observeWorkspaceProjection = Effect.fn('view.observeWorkspaceProjection')(function*(root: string, timing?: RequestTiming) {
  let drift = { files: [] as string[], directories: [] as string[], publicationChanged: false };
  const snapshot = yield* compileWorkspace(root, 'off', timing, value => { drift = value; });
  return { snapshot, drift };
});

/** Git needs current configuration, not the document, code, or evidence projections. */
export const getViewGitStatus = Effect.fn('view.getViewGitStatus')(function*(rootInput: string, baselineCache?: GitBaselineCache) {
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const config = directConfig(root);
  const testRoots = config.project === null ? [] : yield* withRepository(root,
    repo => Effect.succeed(repo.config.testRoots), { access: 'read' });
  return yield* getGitStatus(root, true, baselineCache, testRoots);
});

export const getViewFile = Effect.fn('view.getViewFile')(function*(root: string, path: string, timing?: RequestTiming): Effect.fn.Return<ViewFile, ConcordError> {
  const sync = measuredSync(timing);
  const validatedRoot = yield* sync('view.validateRoot', () => validateViewRoot(root));
  const config = yield* sync('view.readConfig', () => directConfig(validatedRoot));
  if (config.project === null) {
    if (path !== config.path || config.source === undefined) return yield* Effect.fail(new ConcordError('FileNotFound', 'Only the malformed project configuration diagnostic is available until configuration is repaired'));
    return { path, body: config.source, digest: config.configDigest! };
  }
  return yield* withRepository(validatedRoot, (repo) => Effect.gen(function*() {
    const ordinary = yield* snapshotSync(repo, timing, 'view.readFile', () => repo.snapshot(() => {
      const listed = inspectDocumentFile(repo, path);
      if (listed !== undefined) return listed.document?.metadata.kind === 'issue'
        ? { ...listed, feedback: listFeedback(repo, [listed.document])[0] }
        : listed;
      if (isSourcePath(repo, path)) {
        let source: ReturnType<typeof readSource>;
        try { source = readSource(repo, path); }
        catch (cause) {
          if (cause instanceof ConcordError && cause.code === 'SourceNotFound') return undefined;
          throw cause;
        }
        return { path: source.path, body: source.body, digest: source.digest };
      }
      if (path === repo.configSnapshot.path) {
        return { path, body: repo.configSnapshot.source, digest: repo.configSnapshot.digest, project: repo.config };
      }
      return undefined;
    }));
    if (ordinary !== undefined) return ordinary;

    const projected = yield* Effect.result(readRepositoryTestView(validatedRoot));
    if (Result.isSuccess(projected) && projected.success.some(test => test.file === path)) {
      return yield* snapshotSync(repo, timing, 'view.readRepositoryTestFile', () => repo.snapshot(() => {
        const body = repo.read(path);
        if (body === undefined) throw new ConcordError('FileNotFound', 'The explicitly associated project test file no longer exists');
        return { path, body, digest: digest(body) };
      }));
    }
    return yield* Effect.fail(new ConcordError('FileNotFound', 'The requested path is not in the Concord document, configured source, or explicitly associated project test inventory'));
  }), { access: 'read' }, timing);
});

function executeWithRepo(repo: LocalRepository, action: Exclude<ViewAction, { action: 'init' | 'recover' | 'template.show' | 'feedback.sync' | 'feedback.check' }>): unknown {
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  switch (action.action) {
    case 'document.create': return createDocument(repo, action.kind, { ...action, dryRun });
    case 'document.set': return setMarkdown(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'document.metadata': return setMetadata(repo, action.reference, { title: action.title, observedAt: action.observedAt, sources: action.sources, constitutionRefs: action.constitutionRefs }, action.expectedDigest, dryRun);
    case 'page.add': return addPage(repo, action.kind, action.id, action.page, dryRun, action.plan);
    case 'roadmap.adopt': return adoptRoadmap(repo, action.id, action.feature, dryRun);
    case 'design.decide': return decideDesign(repo, action.id, action.selected, action.targets, action.reason, dryRun);
    case 'design.correct-reason': return correctDesignReason(repo, action.id, action.reason, action.memory, action.explanation, action.expectedDigest, action.expectedMemoryDigest, dryRun);
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
    case 'memory.index': return knowledgeIndex(repo, 'memory');
    case 'memory.recall': return knowledgeRecall(repo, 'memory', action.query);
    case 'memory.edit': return editKnowledge(repo, 'memory', action.id, action.body, action.expectedDigest, dryRun);
    case 'memory.activate': return activateMemory(repo, action.id, action.reason, dryRun);
    case 'memory.reopen': return reopenMemory(repo, action.id, action.reason, dryRun);
    case 'memory.supersede': return supersedeMemory(repo, action.id, action.replacement, action.reason, dryRun);
    case 'memory.promote': return promoteMemory(repo, action.id, action.target, dryRun);
    case 'memory.retire': return retirePromotion(repo, action.id, action.target, action.reason, dryRun);
    case 'issue.link': return linkIssue(repo, action.id, action.memory, dryRun, action.kind);
    case 'issue.list': { const { action: _, ...filter } = action; return { operation: 'issue-list', drafts: listFeedback(repo, undefined, filter).map(item => item.document) }; }
    case 'feedback.list': { const { action: _, ...filter } = action; return { operation: 'feedback-list', feedback: listFeedback(repo, undefined, filter) }; }
    case 'issue.index': return knowledgeIndex(repo, 'issue');
    case 'issue.recall': return knowledgeRecall(repo, 'issue', action.query);
    case 'issue.edit': return editKnowledge(repo, 'issue', action.id, action.body, action.expectedDigest, dryRun);
    case 'issue.remove': return removeIssue(repo, action.id, action.expectedDigest, dryRun);
    case 'issue.adopt': return adoptIssue(repo, action.id, action.to, dryRun);
    case 'issue.retire': return retireIssue(repo, action.id, action.from, dryRun);
    case 'issue.reopen': return reopenIssue(repo, action.id, action.reason, dryRun);
    case 'issue.close': { const { action: _, id, dryRun: __, ...closure } = action; return closeIssue(repo, id, decode(IssueClosureSchema, { ...closure, kind: closure.kind ?? 'closed' }, 'Issue closure'), dryRun); }
    case 'feedback.link': throw new ConcordError('CommandRetired', 'Use concord issue adopt --to', { command: 'concord feedback link', replacement: 'concord issue adopt --to' });
    case 'source.set': return setSource(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'writing.index': return writingIndex(repo);
    case 'writing.show': return showWriting(repo, action.path);
    case 'writing.set': return setWriting(repo, action.policy, action.expectedDigest, dryRun, action.path);
    case 'writing.check': return checkWriting(repo, action.path);
    case 'concepts.index': return indexConcepts(repo);
    case 'concepts.show': return showConcepts(repo, action.path);
    case 'concepts.set': return setConcepts(repo, action.catalog, action.expectedDigest, dryRun, action.path);
    case 'config.set': return setConfig(repo, action.config, action.expectedDigest, dryRun);
    case 'constitution.initialize': return initializeConstitution(repo, dryRun);
    case 'constitution.adopt': return adoptConstitution(repo, action.body, action.reason, action.impact, action.sources, action.expectedDigest, dryRun);
    case 'constitution.amend': return amendConstitution(repo, action.body, action.reason, action.impact, action.sources, action.expectedDigest, dryRun);
    case 'code.annotate': return codeSnippet(repo, action.scope, action.contracts);
    case 'code.locate': return locateCode(repo, action.path, action.line);
    case 'test.annotate': return annotationSnippet(repo, action.contract, action.regressions);
    case 'evidence.show': return readEvidence(repo, action.id);
    case 'cache.status': return cacheStatus(repo);
    case 'cache.clear': return dryRun ? previewCacheClear(repo) : clearCache(repo);
    case 'cache.rebuild': {
      const annotations = scanAnnotations(repo, { cache: 'rebuild' });
      const code = scanCode(repo, { cache: 'rebuild' });
      return { ...annotations, codeCache: code.cache };
    }
    case 'check': {
      return checkProject(repo);
    }
    case 'trace.check': {
      const trace = buildTrace(repo);
      return { operation: 'trace-check', ok: trace.complete, complete: trace.complete, findings: trace.findings, edges: trace.edges };
    }
    case 'trace.show': return traceShow(repo, action.reference);
    case 'review.render': return { operation: 'review-render', markdown: renderReview(repo, action.reference) };
    case 'doctor': return doctor(repo);
  }
}

/** Shared by HTTP and CLI action; unknown future actions conservatively require write access. */
function actionAccess(action: ViewAction['action']): 'read' | 'write' {
  switch (action) {
    case 'design.check': case 'memory.index': case 'memory.recall': case 'issue.index': case 'issue.recall': case 'issue.list': case 'feedback.list':
    case 'writing.index': case 'writing.show': case 'writing.check': case 'concepts.index': case 'concepts.show':
    case 'code.annotate': case 'code.locate': case 'test.annotate': case 'evidence.show': case 'cache.status':
    case 'check': case 'trace.check': case 'trace.show': case 'review.render': case 'doctor': case 'template.show':
      return 'read';
    default: return 'write';
  }
}

export const executeViewAction = Effect.fn('view.executeAction')(function*(rootInput: string, input: unknown, signal?: AbortSignal, timing?: RequestTiming): Effect.fn.Return<unknown, ConcordError> {
  const sync = measuredSync(timing);
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const action = yield* sync('view.decodeAction', () => decodeViewAction(input));
  if (action.action === 'template.show') return yield* sync('view.template', () => ({ operation: 'template-show', name: action.name, body: templateBody(action.name, action.title ?? 'Your title') }));
  if (action.action === 'init') {
    if (action.docsOnly && (action.testRoots?.length ?? 0) > 0) return yield* Effect.fail(new ConcordError('ConflictingOptions', 'docsOnly cannot be combined with testRoots'));
    const dryRun = action.dryRun ?? false;
    return yield* withRepository(root, (repo) => snapshotSync(repo, timing, 'view.initialize', () => repo.snapshot(() => initialize(repo, dryRun, {
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
    }))), { initialize: true, dryRun }, timing);
  }
  if (action.action === 'recover') return yield* recoverLocalState(root);
  if (action.action === 'feedback.sync') return yield* syncFeedback(root, action.connection, { url: action.url, dryRun: action.dryRun, signal });
  if (action.action === 'feedback.check') return yield* checkFeedbackConnection(root, action.connection);
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  return yield* withRepository(root, (repo) => snapshotSync(repo, timing, `view.action.${action.action}`, () => repo.snapshot(() => executeWithRepo(repo, action))), { access: actionAccess(action.action), dryRun }, timing);
});
