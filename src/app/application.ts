import { nativeBindings, readNativeObservations } from '../domain/tests/index.ts';
import { RuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../base/environment/index.ts';
import { renderPage } from './page-render.ts';
import { workspaceSourceDigest } from './workspace-source.ts';
import type { Installation } from '../base/installation/index.ts';
import type { Publication } from "../base/publication/index.ts";
import { openReadRepository, openWriteRepository, Workspace } from "../base/workspace/index.ts";
import { Sources } from '../base/sources/index.ts';
import type { OwnedProcess } from '../base/process/index.ts';
import { checkCurrentProject } from "./check-current.ts";
import { Effect, Result, Predicate, Schedule } from "effect";
import { recoverLocalState } from "./recovery.ts";
import { waitForPublication } from "../base/publication/index.ts";
import { getGitStatus, type GitBaselineCache } from "./git-view.ts";
import { cacheStatus, clearCache, previewCacheClear, scanAnnotations } from "../domain/tests/index.ts";
import { codeSnippet, locateCode } from "./code-commands.ts";
import { scanCode } from "../domain/code/index.ts";
import { adoptRoadmap } from "./adopt-roadmap.ts";
import { createDocument } from "./create-document.ts";
import { closeIssue, linkIssue, unlinkIssue } from "../domain/issues/index.ts";
import { linkMemory } from "./memory-relations.ts";
import { checkFeedbackConnection, listFeedback, syncFeedback } from "../domain/feedback/index.ts";
import { readFeedbackCache } from "../base/cache/index.ts";
import { rebuildCache } from './cache-rebuild.ts';
import { HawdbFailure } from "../base/cache/index.ts";
import { editKnowledge, knowledgeIndex, knowledgeSearchRecords, removeIssue } from "./knowledge.ts";
import { KnowledgeSearch, type KnowledgeSearchOwner } from './knowledge-search.ts';
import { inspectDocuments, inspectDocumentFile, isSourcePath, readSource, setConfig, setMarkdown, setSource } from "./editing.ts";
import { annotationSnippet } from "../domain/onboarding/index.ts";
import { doctor } from "./onboarding.ts";
import { projectInitializationRequired, uninitializedDoctor } from './project-onboarding.ts';
import { ConcordError, decode, digest, failure } from "../model/index.ts";
import type { LocalRepository } from "../base/workspace/index.ts";
import { discoverRoot, git } from "../base/workspace/index.ts";
import { initialize } from "./initialize.ts";
import { listTemplates, templateBody } from "../domain/documents/index.ts";
import { buildTrace } from "../domain/trace/index.ts";
import { renderReview, traceShow } from "./trace-queries.ts";
import { readWritingPolicy } from "../domain/writing/index.ts";
import { ViewActionSchema, type ViewAction, type ViewFile, type WorkspaceSnapshot } from "../model/index.ts";
import { showWriting, writingIndex } from "../domain/writing/index.ts";
import { checkWriting } from "../domain/writing/index.ts";
import { checkProject } from "./project-check.ts";
import { indexConcepts, showConcepts } from "../domain/concepts/index.ts";
import type { RequestTiming } from "./request-timing.ts";

const sync = <A>(name: string, evaluate: () => A | Promise<A>): Effect.Effect<A, ConcordError> => Effect.tryPromise({
  try: async () => await evaluate(),
  catch: failure,
}).pipe(Effect.uninterruptible, Effect.withSpan(name));
const measuredSync = (timing?: RequestTiming) => <A>(name: string, evaluate: () => A | Promise<A>): Effect.Effect<A, ConcordError> =>
  sync(name, () => timing === undefined ? evaluate() : timing.async(name, async () => await evaluate()));

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md
export function validateViewRoot(input: string, runtime?: RuntimeEnvironmentSnapshot): string {
  const root = discoverRoot(input, true, runtime);
  if (git(root, ['rev-parse', '--show-toplevel'], runtime?.env) !== root) {
    throw new ConcordError('ProjectRootInvalid', 'The view root must be the Git worktree top-level directory');
  }
  return root;
}

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md
export function decodeViewAction(input: unknown): ViewAction {
  return decode(ViewActionSchema, input, 'view action');
}

// @concord-code
// @concord-implements docs/feature/portable-coordination/architecture.md#invariants
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
    case 'memory.link':
    case 'issue.unlink':
    case 'roadmap.start':
    case 'issue.link':
    case 'issue.edit':
    case 'issue.remove':
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

// @concord-begin
// @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
type OpenOptions = { readonly initialize?: boolean; readonly recover?: boolean; readonly dryRun?: boolean; readonly access?: 'read' | 'write'; readonly persistentCache?: 'use' | 'off' };
// @concord-end
function withRepository<A, R>(root: string, operation: (repo: LocalRepository) => Effect.Effect<A, ConcordError, R>, options: OpenOptions & { readonly access: 'read' }, timing?: RequestTiming): Effect.Effect<A, ConcordError, R | Workspace>;
function withRepository<A, R>(root: string, operation: (repo: LocalRepository) => Effect.Effect<A, ConcordError, R>, options?: OpenOptions, timing?: RequestTiming): Effect.Effect<A, ConcordError, R | Workspace | Publication>;
function withRepository<A, R>(root: string, operation: (repo: LocalRepository) => Effect.Effect<A, ConcordError, R>, options: OpenOptions = {}, timing?: RequestTiming): Effect.Effect<A, ConcordError, R | Workspace | Publication> {
  return Effect.scoped(
    waitForPublication(reclaimPublication => options.access === 'read'
      ? openReadRepository(root, { optimistic: true, ...options, access: 'read', reclaimPublication })
      : openWriteRepository(root, { optimistic: true, ...options, reclaimPublication })).pipe(Effect.flatMap(operation)),
  );
}

// @concord-code
// @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
function snapshotSync<A>(repo: LocalRepository, timing: RequestTiming | undefined, name: string, evaluate: () => A | Promise<A>): Effect.Effect<A, ConcordError, Sources> {
  return Effect.flatMap(Sources, sources => sources.snapshot(repo, measuredSync(timing)(name, evaluate)));
}

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
const directConfig = Effect.fn('view.readConfig')(function*(root: string, timing?: RequestTiming) {
  const workspace = yield* Workspace;
  const operation = workspace.inspectConfiguration(root);
  const current = yield* (timing === undefined ? operation : timing.effect('view.readConfig', operation));
  return { project: current.snapshot?.config ?? null, configDigest: current.digest, source: current.source, path: current.path,
    ...(current.diagnostic === undefined ? {} : { diagnostic: { error: current.diagnostic.code, message: current.diagnostic.message } }) };
});
// @concord-end

/** Missing or malformed project configuration remains inspectable without manufacturing identity. */
// @concord-begin
// @concord-implements docs/feature/web-workbench/architecture.md
// @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#web
const compileWorkspace = Effect.fn('view.compileWorkspace')(function*(rootInput: string, cache: 'use' | 'off', timing?: RequestTiming, observe?: (drift: { files: string[]; directories: string[]; publicationChanged: boolean }) => void): Effect.fn.Return<WorkspaceSnapshot, ConcordError, Workspace | Sources | Installation | RuntimeEnvironment> {
  const sync = measuredSync(timing);
  const environment = yield* RuntimeEnvironment;
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput, environment));
  const required = yield* sync('view.initialization', () => projectInitializationRequired(root, false, environment));
  if (required) return { root, project: null, complete: true, configDigest: null, documents: [], feedback: [], pages: [], cases: [], bindings: [], codes: [], edges: [], findings: [], sources: [], evidenceIds: [], templates: [], cache: { status: 'off' }, diagnostics: uninitializedDoctor(required, 'unknown') };
  const config = yield* directConfig(root, timing);
  const templates = yield* listTemplates();
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
      bindings: [],
      codes: [],
      edges: [],
      findings: [],
      sources: [],
      evidenceIds: [],
      templates,
      cache: { status: 'unavailable' },
      diagnostics: config.diagnostic,
    };
  }
  return yield* withRepository(root, (repo) => Effect.gen(function*() {
    const compile = async () => repo.snapshot(async () => {
    const currentConfigSource = repo.configSnapshot.source;
    const inspected = timing === undefined ? inspectDocuments(repo) : timing.sync('view.inspectDocuments', () => inspectDocuments(repo));
    let cases: Awaited<ReturnType<typeof scanAnnotations>>;
    let codes: Awaited<ReturnType<typeof scanCode>>['codes'];
    let codeFiles: Awaited<ReturnType<typeof scanCode>>['files'];
    let edges: Awaited<ReturnType<typeof buildTrace>>['edges'] = [];
    let findings = [...inspected.findings];
    let diagnostics: unknown;
    try {
      const compile = async () => buildTrace(repo, cache, { timing, inventory: { documents: inspected.documents, findings: inspected.findings, complete: inspected.findings.length === 0 } });
      const trace = await (timing === undefined ? compile() : timing.async('view.buildTrace', compile));
      timing?.cache(trace.codeCache, 'code');
      cases = trace.annotations;
      codes = trace.codeDeclarations;
      codeFiles = trace.codeFiles;
      edges = trace.edges;
      findings = [...trace.findings];
      diagnostics = await doctor(repo, trace, cache);
    } catch (cause) {
      if (observe !== undefined && cause instanceof ConcordError && ['UnsafePath', 'RecoveryRequired', 'InvalidFile'].includes(cause.code)) throw cause;
      cases = await scanAnnotations(repo, { cache });
      const code = await scanCode(repo, { cache });
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
      bindings: nativeBindings(repo, cases.cases, readNativeObservations(repo)),
      codes,
      edges,
      findings,
      sources: [...new Map([...cases.files, ...codeFiles].map(file => [file.path, file])).values()].sort((left, right) => left.path.localeCompare(right.path)),
      evidenceIds: [],
      templates,
      cache: cases.cache,
      diagnostics,
    };
    });
    const snapshot = yield* observe === undefined
      ? snapshotSync(repo, timing, 'view.compileWorkspace', compile)
      : Effect.gen(function*() {
        const sources = yield* Sources;
        const operation = sources.observeProjection(repo, sync('view.compileProjection', compile));
        const result = yield* (timing === undefined ? operation : timing.effect('view.observeProjection', operation));
        observe(result.drift);
        return result.value;
      });
    return { ...snapshot };
  }), { access: 'read', persistentCache: cache }, timing);
});

export const getWorkspaceSnapshot = (root: string, cache: 'use' | 'off' = 'off', timing?: RequestTiming) => compileWorkspace(root, cache, timing);
export const observeWorkspaceProjection = Effect.fn('view.observeWorkspaceProjection')(function*(root: string, timing?: RequestTiming) {
  let drift = { files: [] as string[], directories: [] as string[], publicationChanged: false };
  const sourceDigest = yield* workspaceSourceDigest(root);
  const snapshot = yield* compileWorkspace(root, 'off', timing, value => { drift = value; });
  if ((yield* workspaceSourceDigest(root)) !== sourceDigest) drift = { ...drift, files: [...new Set([...drift.files, '.'])] };
  return { snapshot, drift, sourceDigest };
});
// @concord-end

/** Git needs current configuration, not the document, code, or evidence projections. */
// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/review-local-changes.md
export const getViewGitStatus = Effect.fn('view.getViewGitStatus')(function*(rootInput: string, baselineCache?: GitBaselineCache) {
  const environment = yield* RuntimeEnvironment;
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput, environment));
  const config = yield* directConfig(root);
  const testRoots = config.project?.testRoots ?? [];
  return yield* getGitStatus(root, true, baselineCache, testRoots);
});
// @concord-end

// @concord-begin
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
export const getViewFile = Effect.fn('view.getViewFile')(function*(root: string, path: string, timing?: RequestTiming): Effect.fn.Return<ViewFile, ConcordError, Workspace | Sources | Installation | RuntimeEnvironment> {
  const sync = measuredSync(timing);
  const environment = yield* RuntimeEnvironment;
  const validatedRoot = yield* sync('view.validateRoot', () => validateViewRoot(root, environment));
  const config = yield* directConfig(validatedRoot, timing);
  if (config.project === null) {
    if (path !== config.path || config.source === undefined) return yield* Effect.fail(new ConcordError('FileNotFound', 'Only the malformed project configuration diagnostic is available until configuration is repaired'));
    return { path, body: config.source, digest: config.configDigest! };
  }
  return yield* withRepository(validatedRoot, (repo) => Effect.gen(function*() {
    const cacheDeadline = performance.now() + 500;
    const readOrdinary = snapshotSync(repo, timing, 'view.readFile', () => repo.snapshot(() => {
      const listed = inspectDocumentFile(repo, path);
      if (listed !== undefined) {
        if (listed.document?.metadata.kind !== 'issue') return listed;
        // Keep the successful read handle in this snapshot. A brief projection
        // writer must not permanently turn an existing remote cache into absence.
        try { if (listed.document.metadata.source !== undefined) readFeedbackCache(repo); }
        catch (cause) {
          if (cause instanceof HawdbFailure && cause.code === 'HawdbBusy' && performance.now() < cacheDeadline) throw new ConcordError('HawdbBusy', cause.message);
          // Persistent or damaged caches remain optional; listFeedback reports
          // their warning and still returns the local and first-import bodies.
        }
        return { ...listed, feedback: listFeedback(repo, [listed.document])[0] };
      }
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
        return { path, body: repo.configSnapshot.source, digest: repo.configSnapshot.digest, project: repo.configSnapshot.config };
      }
      return undefined;
    }));
    let read = yield* Effect.result(readOrdinary);
    while (Result.isFailure(read) && read.failure.code === 'HawdbBusy') {
      // snapshotSync releases its handle and observation scope before yielding.
      yield* Effect.sleep('10 millis');
      read = yield* Effect.result(readOrdinary);
    }
    if (Result.isFailure(read)) return yield* Effect.fail(read.failure);
    const ordinary = read.success;
    if (ordinary !== undefined) return ordinary;

    return yield* Effect.fail(new ConcordError('FileNotFound', 'The requested path is not in the Concord document, configured source, or explicitly associated project test inventory'));
  }), { access: 'read' }, timing);
});
// @concord-end

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
async function executeWithRepo(repo: LocalRepository, action: Exclude<ViewAction, { action: 'init' | 'recover' | 'template.show' | 'feedback.sync' | 'feedback.check' | 'file.get' | 'page.render' }>, searchOwner?: KnowledgeSearchOwner, signal?: AbortSignal): Promise<unknown> {
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  switch (action.action) {
    case 'document.create': throw new ConcordError('InvalidInput', 'Creation must run in its Effect scope');
    case 'memory.link': return (await linkMemory(repo, action.id, action.target, action.role, dryRun));
    case 'issue.unlink': return (await unlinkIssue(repo, action.id, action.memory, dryRun, action.role));
    case 'document.set': return (await setMarkdown(repo, action.path, action.body, action.expectedDigest, dryRun));
    case 'roadmap.start': return (await adoptRoadmap(repo, action.id, action.feature, dryRun));
    case 'memory.index': return knowledgeIndex(repo, 'memory');
    case 'memory.search': return knowledgeSearchRecords(repo, 'memory', action.query, searchOwner, signal);
    case 'issue.link': return (await linkIssue(repo, action.id, action.memory, dryRun, action.role));
    case 'issue.list': { const { action: _, ...filter } = action; return { operation: 'issue-list', drafts: listFeedback(repo, undefined, filter).map(item => item.document) }; }
    case 'feedback.list': { const { action: _, ...filter } = action; return { operation: 'feedback-list', feedback: listFeedback(repo, undefined, filter) }; }
    case 'issue.index': return knowledgeIndex(repo, 'issue');
    case 'issue.search': return knowledgeSearchRecords(repo, 'issue', action.query, searchOwner, signal);
    case 'issue.edit': return (await editKnowledge(repo, 'issue', action.id, action.body, action.expectedDigest, dryRun));
    case 'issue.remove': return (await removeIssue(repo, action.id, action.expectedDigest, dryRun));
    case 'issue.close': return (await closeIssue(repo, action.id, action.reason, dryRun));
    case 'feedback.link': throw new ConcordError('CommandRetired', 'Use concord issue link <id> --role spec <target>', { command: 'concord feedback link', replacement: 'concord issue link <id> --role spec <target>' });
    case 'source.set': return (await setSource(repo, action.path, action.body, action.expectedDigest, dryRun));
    case 'writing.index': return writingIndex(repo);
    case 'writing.show': return showWriting(repo, action.path);
    case 'writing.check': return checkWriting(repo, action.path, true, action.selection);
    case 'concepts.index': return indexConcepts(repo);
    case 'concepts.show': return showConcepts(repo, action.path);
    case 'config.set': return (await setConfig(repo, action.config, action.expectedDigest, dryRun));
    case 'code.marker': return codeSnippet(repo, action.scope, action.contracts);
    case 'code.at': return (await locateCode(repo, action.path, action.line));
    case 'test.marker': return annotationSnippet(repo, action.contract, action.issues);
    case 'cache.status': return cacheStatus(repo);
    case 'cache.clear': return dryRun ? previewCacheClear(repo) : clearCache(repo);
    case 'cache.rebuild': return (await rebuildCache(repo));
    case 'check': {
      return (await checkProject(repo));
    }
    case 'trace.check': {
      const trace = (await buildTrace(repo));
      return { operation: 'trace-check', ok: trace.complete, complete: trace.complete, findings: trace.findings, edges: trace.edges };
    }
    case 'trace.show': return (await traceShow(repo, action.reference));
    case 'review': return { operation: 'review-render', markdown: (await renderReview(repo, action.reference)) };
    case 'doctor': return (await doctor(repo, undefined, 'off'));
  }
}

/** Shared by HTTP and CLI action; unknown future actions conservatively require write access. */
// @concord-code
// @concord-implements docs/feature/portable-coordination/architecture.md#invariants
function actionAccess(action: ViewAction['action']): 'read' | 'write' {
  switch (action) {
    case 'memory.index': case 'memory.search': case 'issue.index': case 'issue.search': case 'issue.list': case 'feedback.list':
    case 'writing.index': case 'writing.show': case 'writing.check': case 'concepts.index': case 'concepts.show':
    case 'code.marker': case 'code.at': case 'test.marker': case 'cache.status':
    case 'check': case 'trace.check': case 'trace.show': case 'review': case 'doctor': case 'template.show': case 'file.get': case 'page.render':
      return 'read';
    default: return 'write';
  }
}

// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
export const executeViewAction = Effect.fn('view.executeAction')(function*(rootInput: string, input: unknown, signal?: AbortSignal, timing?: RequestTiming): Effect.fn.Return<unknown, ConcordError, Publication | Workspace | Sources | OwnedProcess | Installation | RuntimeEnvironment> {
  const sync = measuredSync(timing);
  const environment = yield* RuntimeEnvironment;
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput, environment));
  const action = yield* sync('view.decodeAction', () => decodeViewAction(input));
  if (action.action === 'file.get') return yield* getViewFile(root, action.path, timing);
  if (action.action === 'page.render') return yield* renderPage(root, action.path, action.theme);
  if (action.action === 'template.show') return { operation: 'template-show', name: action.name, body: yield* templateBody(action.name, action.title ?? 'Your title') };
  if (action.action === 'document.create') return yield* withRepository(root, repo => createDocument(repo, action.kind, { ...action, dryRun: action.dryRun ?? false }), { dryRun: action.dryRun }, timing);
  if (action.action === 'init') {
    if (action.docsOnly && (action.testRoots?.length ?? 0) > 0) return yield* Effect.fail(new ConcordError('ConflictingOptions', 'docsOnly cannot be combined with testRoots'));
    const dryRun = action.dryRun ?? false;
    return yield* withRepository(root, (repo) => initialize(repo, dryRun, {
      testRoots: action.docsOnly ? [] : action.testRoots,
      sourceRoots: action.sourceRoots,
    }), { initialize: true, dryRun }, timing);
  }
  if (action.action === 'check') return yield* checkCurrentProject(root);
  if (action.action === 'recover') return yield* recoverLocalState(root);
  if (action.action === 'feedback.sync') return yield* syncFeedback(root, action.connection, { url: action.url, dryRun: action.dryRun, signal });
  if (action.action === 'feedback.check') return yield* checkFeedbackConnection(root, action.connection);
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  const owner = yield* Effect.serviceOption(KnowledgeSearch);
  const searchOwner = owner._tag === 'Some' ? owner.value : undefined;
  if (action.action === 'memory.search' || action.action === 'issue.search') {
    return yield* withRepository(root, repo => Effect.gen(function*() {
      const sources = yield* Sources;
      let pending: Promise<unknown> | undefined;
      const search = Effect.tryPromise({
        try: interrupted => pending = repo.snapshot(() => executeWithRepo(repo, action, searchOwner, signal === undefined ? interrupted : AbortSignal.any([signal, interrupted]))),
        catch: failure,
      }).pipe(Effect.ensuring(Effect.promise(async () => { await pending?.then(() => undefined, () => undefined); })));
      return yield* sources.snapshot(repo, timing === undefined ? search : timing.effect(`view.action.${action.action}`, search));
    }), { access: 'read', dryRun }, timing).pipe(Effect.retry({ times: 2, schedule: Schedule.spaced('50 millis'), while: error => error.code === 'SourceChanged' || error.code === 'FileChangedSinceRead' && error.details === 'source-observation' }));
  }
  return yield* withRepository(root, (repo) => snapshotSync(repo, timing, `view.action.${action.action}`, () => repo.snapshot(() => executeWithRepo(repo, action, searchOwner, signal))), { access: actionAccess(action.action), dryRun }, timing);
});
// @concord-end

export const applicationRuntime = Effect.gen(function*() { return yield* RuntimeEnvironment; });
export type ApplicationRuntime = RuntimeEnvironmentSnapshot;
export const locateProjectRoot = (input?: string) => Effect.flatMap(Workspace, workspace => workspace.locate(input, true)).pipe(Effect.map(location => location.root));
export const withSourceSnapshot = <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.flatMap(Sources, sources => sources.snapshot(repo, operation));
