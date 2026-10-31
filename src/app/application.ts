import { Installation } from '../base/installation/index.js';
import type { Publication } from "../base/publication/index.js";
import { openReadRepository, openWriteRepository, Workspace } from "../base/workspace/index.js";
import { Sources } from '../base/sources/index.js';
import type { OwnedProcess } from '../base/process/index.js';
import { checkCurrentProject } from "./check-current.js";
import { Effect, Result, Predicate } from "effect";
import { recoverLocalState } from "./recovery.js";
import { waitForPublication } from "../base/publication/index.js";
import { getGitStatus, type GitBaselineCache } from "./git-view.js";
import { cacheStatus, clearCache, previewCacheClear, scanAnnotations } from "../domain/tests/index.js";
import { codeSnippet, locateCode } from "./code-commands.js";
import { scanCode } from "../domain/code/index.js";
import { adoptRoadmap } from "./adopt-roadmap.js";
import { createDocument } from "./create-document.js";
import { reopenIssue, closeIssue, linkIssue, unlinkIssue } from "../domain/issues/index.js";
import { linkMemory } from "./memory-relations.js";
import { activateMemory, supersedeMemory } from "../domain/memory/index.js";
import { decideDesign, checkDesign, formatDesign, deferDesign } from "../domain/designs/index.js";
import { checkFeedbackConnection, listFeedback, syncFeedback } from "../domain/feedback/index.js";
import { readFeedbackCache } from "../base/cache/index.js";
import { HawdbFailure } from "../base/cache/index.js";
import { editKnowledge, knowledgeIndex, knowledgeRecall, removeIssue } from "./knowledge.js";
import { inspectDocuments, inspectDocumentFile, isSourcePath, readSource, setConfig, setMarkdown, setSource } from "./editing.js";
import { annotationSnippet } from "../domain/onboarding/index.js";
import { doctor } from "./onboarding.js";
import { ConcordError, IssueClosureSchema, decode, digest, failure } from "../model/index.js";
import { discoverRoot, git, LocalRepository } from "../base/workspace/index.js";
import { initialize } from "./initialize.js";
import { adoptConstitution, amendConstitution, initializeConstitution } from "../domain/constitution/index.js";
import { listTemplates, templateBody } from "../domain/documents/index.js";
import { buildTrace } from "../domain/trace/index.js";
import { renderReview, traceShow } from "./trace-queries.js";
import { readWritingPolicy } from "../domain/writing/index.js";
import { ViewActionSchema, type ViewAction, type ViewFile, type WorkspaceSnapshot } from "../model/index.js";
import { showWriting, setWriting, writingIndex } from "../domain/writing/index.js";
import { checkWriting } from "../domain/writing/index.js";
import { checkProject } from "./project-check.js";
import { indexConcepts, setConcepts, showConcepts } from "../domain/concepts/index.js";
import type { RequestTiming } from "./request-timing.js";

const sync = <A>(name: string, evaluate: () => A): Effect.Effect<A, ConcordError> => Effect.try({
  try: evaluate,
  catch: failure,
}).pipe(Effect.withSpan(name));
const measuredSync = (timing?: RequestTiming) => <A>(name: string, evaluate: () => A): Effect.Effect<A, ConcordError> =>
  sync(name, () => timing === undefined ? evaluate() : timing.sync(name, evaluate));

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md
export function validateViewRoot(input: string): string {
  const root = discoverRoot(input, true);
  if (git(root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new ConcordError('ProjectRootInvalid', 'The view root must be the Git worktree top-level directory');
  }
  return root;
}

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md
export function decodeViewAction(input: unknown): ViewAction {
  if (Predicate.isObject(input) && input.action === 'writing.set') readWritingPolicy(JSON.stringify(input.policy), typeof input.path === 'string' ? input.path : undefined);
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
    case 'design.defer':
    case 'roadmap.adopt':
    case 'design.decide':
    case 'design.format':
    case 'memory.activate':
    case 'memory.supersede':
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
function snapshotSync<A>(repo: LocalRepository, timing: RequestTiming | undefined, name: string, evaluate: () => A): Effect.Effect<A, ConcordError, Sources> {
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
const compileWorkspace = Effect.fn('view.compileWorkspace')(function*(rootInput: string, cache: 'use' | 'off', timing?: RequestTiming, observe?: (drift: { files: string[]; directories: string[]; publicationChanged: boolean }) => void): Effect.fn.Return<WorkspaceSnapshot, ConcordError, Workspace | Sources | Installation> {
  const sync = measuredSync(timing);
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
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
    const compile = () => repo.snapshot(() => {
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
      diagnostics = doctor(repo, trace, cache);
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
      evidenceIds: [],
      templates,
      cache: cases.cache,
      diagnostics,
    };
    });
    const snapshot = yield* observe === undefined
      ? snapshotSync(repo, timing, 'view.compileWorkspace', compile)
      : sync('view.observeProjection', () => { const result = repo.observeProjection(compile); observe(result.drift); return result.value; });
    return { ...snapshot };
  }), { access: 'read', persistentCache: cache }, timing);
});

export const getWorkspaceSnapshot = (root: string, cache: 'use' | 'off' = 'off', timing?: RequestTiming) => compileWorkspace(root, cache, timing);
export const observeWorkspaceProjection = Effect.fn('view.observeWorkspaceProjection')(function*(root: string, timing?: RequestTiming) {
  let drift = { files: [] as string[], directories: [] as string[], publicationChanged: false };
  const snapshot = yield* compileWorkspace(root, 'off', timing, value => { drift = value; });
  return { snapshot, drift };
});
// @concord-end

/** Git needs current configuration, not the document, code, or evidence projections. */
// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/review-local-changes.md
export const getViewGitStatus = Effect.fn('view.getViewGitStatus')(function*(rootInput: string, baselineCache?: GitBaselineCache) {
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const config = yield* directConfig(root);
  const testRoots = config.project === null ? [] : yield* withRepository(root,
    repo => Effect.succeed(repo.config.testRoots), { access: 'read' });
  return yield* getGitStatus(root, true, baselineCache, testRoots);
});
// @concord-end

// @concord-begin
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
export const getViewFile = Effect.fn('view.getViewFile')(function*(root: string, path: string, timing?: RequestTiming): Effect.fn.Return<ViewFile, ConcordError, Workspace | Sources | Installation> {
  const sync = measuredSync(timing);
  const validatedRoot = yield* sync('view.validateRoot', () => validateViewRoot(root));
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
function executeWithRepo(repo: LocalRepository, action: Exclude<ViewAction, { action: 'init' | 'recover' | 'template.show' | 'feedback.sync' | 'feedback.check' }>): unknown {
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  switch (action.action) {
    case 'document.create': throw new ConcordError('InvalidInput', 'Creation must run in its Effect scope');
    case 'memory.link': return linkMemory(repo, action.id, action.target, action.role, dryRun);
    case 'issue.unlink': return unlinkIssue(repo, action.id, action.memory, dryRun, action.role);
    case 'design.defer': return deferDesign(repo, action.id, action.reason, dryRun);
    case 'document.set': return setMarkdown(repo, action.path, action.body, action.expectedDigest, dryRun);
    case 'roadmap.adopt': return adoptRoadmap(repo, action.id, action.feature, dryRun);
    case 'design.decide': return decideDesign(repo, action.id, action.selected, action.targets, action.reason, dryRun);
    case 'design.check': return checkDesign(repo, action.id);
    case 'design.format': return formatDesign(repo, action.id, dryRun);
    case 'memory.index': return knowledgeIndex(repo, 'memory');
    case 'memory.recall': return knowledgeRecall(repo, 'memory', action.query);
    case 'memory.activate': return activateMemory(repo, action.id, action.reason, dryRun);
    case 'memory.supersede': return supersedeMemory(repo, action.id, action.replacement, action.reason, dryRun);
    case 'issue.link': return linkIssue(repo, action.id, action.memory, dryRun, action.role);
    case 'issue.list': { const { action: _, ...filter } = action; return { operation: 'issue-list', drafts: listFeedback(repo, undefined, filter).map(item => item.document) }; }
    case 'feedback.list': { const { action: _, ...filter } = action; return { operation: 'feedback-list', feedback: listFeedback(repo, undefined, filter) }; }
    case 'issue.index': return knowledgeIndex(repo, 'issue');
    case 'issue.recall': return knowledgeRecall(repo, 'issue', action.query);
    case 'issue.edit': return editKnowledge(repo, 'issue', action.id, action.body, action.expectedDigest, dryRun);
    case 'issue.remove': return removeIssue(repo, action.id, action.expectedDigest, dryRun);
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
    case 'concepts.set': return setConcepts(repo, action.source, action.expectedDigest, dryRun, action.path);
    case 'config.set': return setConfig(repo, action.config, action.expectedDigest, dryRun);
    case 'constitution.initialize': return initializeConstitution(repo, dryRun);
    case 'constitution.adopt': return adoptConstitution(repo, action.body, action.reason, action.impact, action.sources, action.expectedDigest, dryRun);
    case 'constitution.amend': return amendConstitution(repo, action.body, action.reason, action.impact, action.sources, action.expectedDigest, dryRun);
    case 'code.annotate': return codeSnippet(repo, action.scope, action.contracts);
    case 'code.locate': return locateCode(repo, action.path, action.line);
    case 'test.annotate': return annotationSnippet(repo, action.contract, action.issues);
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
// @concord-code
// @concord-implements docs/feature/portable-coordination/architecture.md#invariants
function actionAccess(action: ViewAction['action']): 'read' | 'write' {
  switch (action) {
    case 'design.check': case 'memory.index': case 'memory.recall': case 'issue.index': case 'issue.recall': case 'issue.list': case 'feedback.list':
    case 'writing.index': case 'writing.show': case 'writing.check': case 'concepts.index': case 'concepts.show':
    case 'code.annotate': case 'code.locate': case 'test.annotate': case 'cache.status':
    case 'check': case 'trace.check': case 'trace.show': case 'review.render': case 'doctor': case 'template.show':
      return 'read';
    default: return 'write';
  }
}

// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
export const executeViewAction = Effect.fn('view.executeAction')(function*(rootInput: string, input: unknown, signal?: AbortSignal, timing?: RequestTiming): Effect.fn.Return<unknown, ConcordError, Publication | Workspace | Sources | OwnedProcess | Installation> {
  const sync = measuredSync(timing);
  const root = yield* sync('view.validateRoot', () => validateViewRoot(rootInput));
  const action = yield* sync('view.decodeAction', () => decodeViewAction(input));
  if (action.action === 'template.show') return { operation: 'template-show', name: action.name, body: yield* templateBody(action.name, action.title ?? 'Your title') };
  if (action.action === 'document.create') return yield* withRepository(root, repo => createDocument(repo, action.kind, { ...action, memoryKind: action.type, dryRun: action.dryRun ?? false }), { dryRun: action.dryRun }, timing);
  if (action.action === 'init') {
    if (action.docsOnly && (action.testRoots?.length ?? 0) > 0) return yield* Effect.fail(new ConcordError('ConflictingOptions', 'docsOnly cannot be combined with testRoots'));
    const dryRun = action.dryRun ?? false;
    return yield* withRepository(root, (repo) => initialize(repo, dryRun, {
      testRoots: action.docsOnly ? [] : action.testRoots,
      sourceRoots: action.sourceRoots,
      runner: action.runner,
      constitutionBody: action.constitutionBody,
      adoptConstitution: action.adoptConstitution,
      constitutionReason: action.constitutionReason,
      constitutionImpact: action.constitutionImpact,
      constitutionSources: action.constitutionSources,
    }), { initialize: true, dryRun }, timing);
  }
  if (action.action === 'check') return yield* checkCurrentProject(root);
  if (action.action === 'recover') return yield* recoverLocalState(root);
  if (action.action === 'feedback.sync') return yield* syncFeedback(root, action.connection, { url: action.url, dryRun: action.dryRun, signal });
  if (action.action === 'feedback.check') return yield* checkFeedbackConnection(root, action.connection);
  const dryRun = 'dryRun' in action ? action.dryRun ?? false : false;
  return yield* withRepository(root, (repo) => snapshotSync(repo, timing, `view.action.${action.action}`, () => repo.snapshot(() => executeWithRepo(repo, action))), { access: actionAccess(action.action), dryRun }, timing);
});
// @concord-end
