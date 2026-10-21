// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { readFileSync } from 'node:fs';
import { Effect } from 'effect';
import { buildTrace, requireValidTrace } from './trace.js';
import { candidateDigest } from './evidence.js';
import { LocalRepository } from './storage.js';
import { closeRepositoryCache, withPersistentCache } from './cache-store.js';
import { readCachePayloads, writeCachePayloads } from './cache-query.js';
import { acquireTraceLeaseSync, readPublicationRevisionSync, releaseTraceLeaseSync } from './coordination.js';
import { beginRun, finalizeRun, finishRun, quarantineRun } from './run-coordination.js';
import { hasConfirmedOwnedGroupCleanup, OwnedProcess } from './owned-process.js';
import { ConcordError, decode, digest, failure, objectDigest, type Repository } from './shared.js';
import { observation } from './observation.js';
import { AnalysisObservationSchema, type AnalysisObservation, type AnalysisValue } from './analysis-values.js';
import { analyzeLanguageServer } from './lsp-client.js';
import { typescriptDependencies } from './typescript-dependencies.js';
import { typescriptPackageVersion } from './typescript-host.js';
import { ANALYSIS_LIMITS } from './language-server-config.js';

const ALGORITHM = 'concord.analysis/v1';
const sync = <A>(run: () => A) => Effect.try({ try: run, catch: failure });
const unitKey = (repo: Repository, analyzer: string): string => objectDigest({ kind: ALGORITHM, projectId: repo.config.projectId, root: repo.root, privateDir: repo.privateDir, analyzer });

/** Entire analysis unit, including membership and declared ignored implementation inputs. */
export function captureAnalysisInputs(repo: Repository) {
  const paths = [...new Set([...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])].flatMap(root => repo.files(root, 'source')))];
  if (paths.length > ANALYSIS_LIMITS.files) throw new ConcordError('AnalysisBudgetExceeded', 'FileLimit');
  const explicit = new Set(['tsconfig.json', 'jsconfig.json', 'package.json', 'pnpm-lock.yaml', ...repo.config.runner.sourceFiles]);
  for (const server of repo.config.languageServers ?? []) {
    try { if (server.cwd !== '.') repo.absolute(server.cwd); }
    catch { throw new ConcordError('InvalidLanguageServer', 'Language server cwd is not a safe repository directory'); }
    for (const path of [...server.implementationFiles, ...server.sourceFiles]) {
      try {
        if (repo.read(path) === undefined) throw new Error('missing');
        explicit.add(path);
      } catch { throw new ConcordError('AnalysisInputUnverified', `Cannot verify declared language server input: ${path}`); }
    }
  }
  const members = [...new Set([...paths, ...explicit])].sort();
  const files = new Map<string, string>(), identities: { path: string; digest: string | null }[] = [];
  for (const path of members) {
    const text = repo.read(path);
    identities.push({ path, digest: text === undefined ? null : digest(readFileSync(repo.absolute(path))) });
    if (text !== undefined) files.set(path, text);
  }
  // Domain readers own contract decoding and provenance, including supporting pages.
  const trace = buildTrace(repo, 'off');
  requireValidTrace(trace);
  const contractPaths = [...new Set([...trace.documents.map(doc => doc.path), ...repo.files('docs').filter(path => path.endsWith('.md') || path.endsWith('.json'))])].sort();
  const contracts = contractPaths.map(path => ({ path, digest: digest(repo.read(path) ?? '') }));
  const identity = { algorithm: ALGORITHM, compiler: typescriptPackageVersion(), projectId: repo.config.projectId, root: repo.root, privateDir: repo.privateDir, config: repo.configSnapshot.digest, candidate: candidateDigest(repo, [...trace.documents]), members: identities, contracts, budgets: ANALYSIS_LIMITS };
  const inputs = objectDigest(identity);
  return { identity, inputs, files, trace, revision: readPublicationRevisionSync(repo.root) };
}
function readCapture(root: string) {
  const reader = new LocalRepository(root, { access: 'read' });
  try { return reader.snapshot(() => captureAnalysisInputs(reader)); }
  finally { reader.close(); }
}
function publishObservations(repo: Repository, values: readonly AnalysisObservation[]): void {
  try {
    withPersistentCache(repo, true, database => writeCachePayloads(database!, 'code_cache', values.map(value => ({ key: unitKey(repo, value.value.analyzer), payload: JSON.stringify(value) }))));
  } catch { throw new ConcordError('LanguageServerFailed', 'Could not publish the analysis observation cache'); }
  finally { closeRepositoryCache(repo); }
}

/** Runner ownership encloses processes; snapshots and publication coordination never enclose waits. */
export const analyzeCode = (repo: LocalRepository) => Effect.gen(function* () {
  const owned = yield* OwnedProcess;
  const prepared = yield* Effect.acquireRelease(sync(() => {
    const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'analysis-start')!;
    let prepared;
    try {
      const captured = readCapture(repo.root);
      prepared = { captured, run: beginRun(repo.root) };
    } finally { releaseTraceLeaseSync(lease, 'analysis-start'); }
    // Exclusive acquisition/release themselves advance the revision; capture our released generation.
    return { ...prepared, captured: { ...prepared.captured, revision: readPublicationRevisionSync(repo.root) } };
  }), prepared => Effect.gen(function* () {
    yield* owned.awaitIdle;
    const idle = (yield* owned.activeCount) === 0;
    const results = yield* owned.cleanupResults;
    yield* Effect.sync(() => {
      try {
        const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'analysis-finish')!;
        try {
          const cleanupOk = idle && results.every(hasConfirmedOwnedGroupCleanup);
          finalizeRun(repo.root, prepared.run, cleanupOk);
          if (cleanupOk) finishRun(repo.root, prepared.run);
        } finally { releaseTraceLeaseSync(lease, 'analysis-finish'); }
      } catch { quarantineRun(repo.root, prepared.run); }
    });
  }));
  const { captured, run } = prepared;
  yield* sync(() => {
    const previous = readStoredAnalysisObservations(repo);
    if (previous.length > 0) publishObservations(repo, previous.map(value => ({ ...value, current: false, complete: false, gaps: [...new Set([...value.gaps, 'SnapshotNotCurrent'])] })));
  });
  const values: AnalysisValue[] = [yield* sync(() => typescriptDependencies(repo, captured.files, captured.trace.annotations.cases, captured.trace.codeDeclarations))];
  for (const server of repo.config.languageServers ?? []) {
    values.push(yield* analyzeLanguageServer(repo, server, captured.files, captured.trace.annotations.cases, captured.trace.codeDeclarations));
  }
  const idle = (yield* owned.activeCount) === 0;
  const results = yield* owned.cleanupResults;
  if (!idle || !results.every(hasConfirmedOwnedGroupCleanup)) return yield* Effect.fail(new ConcordError('AnalysisCleanupUnknown', 'Analysis process group or output pipes remain unconfirmed; runner is quarantined'));
  // Step 5 closes all source and HawDB handles before the short publication section.
  const after = yield* sync(() => {
    try { return readCapture(repo.root); }
    catch { throw new ConcordError('AnalysisSourceChanged', 'Analysis inputs changed before final verification'); }
  });
  if (after.inputs !== captured.inputs || after.revision !== captured.revision) return yield* Effect.fail(new ConcordError('AnalysisSourceChanged', 'Analysis inputs or publication revision changed', { changed: Object.keys(captured.identity).filter(key => objectDigest(Reflect.get(captured.identity,key)) !== objectDigest(Reflect.get(after.identity,key))), revision: [captured.revision, after.revision] }));
  return yield* sync(() => {
    if (readPublicationRevisionSync(repo.root) !== after.revision) throw new ConcordError('AnalysisSourceChanged', 'Publication changed after analysis verification');
    const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'analysis-publish')!;
    try {
      const ownedRevision = readPublicationRevisionSync(repo.root);
      // Recheck noncooperating edits as well as coordinated publication generations.
      let final: ReturnType<typeof readCapture>;
      try { final = readCapture(repo.root); }
      catch { throw new ConcordError('AnalysisSourceChanged', 'Analysis inputs changed at publication'); }
      const invalidated = finalizeRun(repo.root, run, true);
      if (invalidated || final.inputs !== captured.inputs || final.revision !== ownedRevision) throw new ConcordError('AnalysisSourceChanged', 'Analysis run was invalidated or its inputs changed');
      // Currency describes verified repository inputs; external uncertainty stays in gaps.
      const observations = values.map(value => observation(value, captured.inputs, value.gaps, true));
      publishObservations(repo, observations);
      return { operation: 'code-analyze', observations };
    } finally { releaseTraceLeaseSync(lease, 'analysis-publish'); }
  });
}).pipe(Effect.scoped, Effect.mapError(failure), Effect.catchDefect(cause => Effect.fail(failure(cause))));

function readStoredAnalysisObservations(repo: Repository): readonly AnalysisObservation[] {
  const analyzers = ['typescript', ...(repo.config.languageServers ?? []).map(server => server.id)];
  let stored: ReadonlyMap<string, string>;
  try { stored = withPersistentCache(repo, false, database => database === undefined ? new Map() : readCachePayloads(database, 'code_cache', analyzers.map(analyzer => unitKey(repo, analyzer)))); }
  catch { return []; }
  const observations: AnalysisObservation[] = [];
  for (const analyzer of analyzers) {
    const payload = stored.get(unitKey(repo, analyzer));
    if (payload === undefined) continue;
    try {
      const value = decode(AnalysisObservationSchema, JSON.parse(payload), 'analysis observation');
      if (value.value.analyzer === analyzer && (!value.complete || value.gaps.length === 0) && (value.complete || value.gaps.length > 0)) observations.push(value);
    } catch { /* Disposable observation unavailable. */ }
  }
  return observations;
}

/** Missing, damaged and stale observations do not affect the authoritative trace. */
export function readAnalysisObservations(repo: Repository): readonly AnalysisObservation[] {
  const observations = readStoredAnalysisObservations(repo);
  if (observations.length === 0) return [];
  let inputs: string | undefined;
  try { inputs = captureAnalysisInputs(repo).inputs; } catch { /* History remains explicitly non-current. */ }
  return observations.map(value => ({ ...value, current: value.current && value.inputs === inputs, complete: value.complete && value.inputs === inputs, gaps: value.inputs === inputs ? value.gaps : [...new Set([...value.gaps, 'SnapshotNotCurrent'])] }));
}
