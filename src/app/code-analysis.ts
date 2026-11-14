import type { RuntimeEnvironmentSnapshot } from '../base/environment/index.ts';
import { snapshotBytes } from '../base/sources/index.ts';
import { Effect, Schema } from "effect";
import { buildTrace, requireValidTrace } from "../domain/trace/index.ts";
import { worktreeIdentity } from "../base/git/index.ts";
import { openReadRepository, repositoryRuntime, type LocalRepository } from "../base/workspace/index.ts";
import { closeRepositoryCache, PersistentCache } from "../base/cache/index.ts";
import { readCachePayloads, writeCachePayloads } from "../base/cache/index.ts";
import { acquireTraceLeaseSync, releaseTraceLeaseSync } from "../base/publication/index.ts";
import { beginRun, finalizeRun, finishRun, quarantineRun } from "../base/publication/index.ts";
import { hasConfirmedOwnedGroupCleanup, OwnedProcess } from "../base/process/index.ts";
import { ConcordError, decode, digest, failure, objectDigest, type Repository } from "../model/index.ts";
import { observation } from "../model/index.ts";
import { AnalysisObservationSchema, type AnalysisObservation, type AnalysisValue } from "../model/index.ts";
import { analyzeLanguageServer } from "../base/process/index.ts";
import { typescriptDependencies } from "../domain/code/index.ts";
import { typescriptPackageVersion } from "../base/process/index.ts";
import { ANALYSIS_LIMITS } from "../model/index.ts";
import { captureNativeAnalysis } from "./native-analysis.ts";


const ALGORITHM = 'concord.analysis/v1';

const sync = <A>(run: () => A | Promise<A>) => Effect.tryPromise({ try: async () => await run(), catch: failure }).pipe(Effect.uninterruptible);

const unitKey = (repo: Repository, analyzer: string): string => objectDigest({ kind: ALGORITHM, root: repo.root, privateDir: repo.privateDir, analyzer });


/** Entire analysis unit, including membership and declared ignored implementation inputs. */
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md#配置与结果
export async function captureAnalysisInputs(repo: Repository, runtime: RuntimeEnvironmentSnapshot = repositoryRuntime(repo)) {
  const paths = [...new Set([...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])].flatMap(root => repo.files(root, 'source')))];
  if (paths.length > ANALYSIS_LIMITS.files) throw new ConcordError('AnalysisBudgetExceeded', 'FileLimit');
  const explicit = new Set(['tsconfig.json', 'jsconfig.json', 'package.json', 'pnpm-lock.yaml', ]);
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
    identities.push({ path, digest: text === undefined ? null : digest(snapshotBytes(repo, path)!) });
    if (text !== undefined) files.set(path, text);
  }
  // Domain readers own contract decoding and provenance, including supporting pages.
  const trace = (await buildTrace(repo, 'off'));
  requireValidTrace(trace);
  const contractPaths = [...new Set([...trace.documents.map(doc => doc.path), ...repo.files('docs').filter(path => path.endsWith('.md') || path.endsWith('.json'))])].sort();
  const contracts = contractPaths.map(path => ({ path, digest: digest(repo.read(path) ?? '') }));
  const native = captureNativeAnalysis(repo, trace.annotations.cases);
  const identity = { algorithm: ALGORITHM, compiler: typescriptPackageVersion(), root: repo.root, privateDir: repo.privateDir, config: repo.configSnapshot.digest, candidate: worktreeIdentity(repo, true, runtime.env), members: identities, contracts, budgets: ANALYSIS_LIMITS, native: { observations: native.identity, bindings: [...native.scopes], gaps: [...native.gaps] } };
  const inputs = objectDigest(identity);
  return { identity, inputs, files, trace, native };
}

async function captureReader(reader: LocalRepository, runtime: RuntimeEnvironmentSnapshot) {
  const reads = new Map<string, string | null>();
  const listings = new Map<string, { prefix: string; scope?: 'source'; paths: string[] }>();
  // Freeze primitive source preimages, including reads made by native binding capture.
  // The publication guard replays only filesystem reads, never domain/cache readers.
  const source: Repository = {
    access: 'read', root: reader.root, privateDir: reader.privateDir,
    config: reader.config, configSnapshot: reader.configSnapshot,
    readBytes: path => reader.readBytes(path), inspect: path => reader.inspect(path), rootFiles: () => reader.rootFiles(), environment: names => reader.environment(names), runtimeInputs: (command, names) => reader.runtimeInputs(command, names),
    absolute: path => reader.absolute(path),
    snapshot: read => reader.snapshot(read),
    read: path => {
      const value = reader.read(path);
      reads.set(path, value === undefined ? null : digest(snapshotBytes(reader, path)!));
      return value;
    },
    files: (prefix, scope) => {
      const paths = reader.files(prefix, scope);
      listings.set(JSON.stringify([prefix, scope]), { prefix, scope, paths: [...paths] });
      return paths;
    },
    publish: () => { throw new ConcordError('ReadOnlyRepository', 'Analysis capture is read-only'); },
  };
  try {
    const captured = (await reader.snapshot(async () => {
      try { return (await PersistentCache.withView(reader, source, async () => (await captureAnalysisInputs(source, runtime)))); }
      finally { closeRepositoryCache(source); }
    }));
    return { ...captured, verifyFiles: () => reader.snapshot(() => {
      for (const [path, expected] of reads) {
        const value = reader.read(path);
        if ((value === undefined ? null : digest(snapshotBytes(reader, path)!)) !== expected) throw new ConcordError('AnalysisSourceChanged', `Analysis input changed: ${path}`);
      }
      for (const { prefix, scope, paths } of listings.values()) {
        if (objectDigest(reader.files(prefix, scope)) !== objectDigest(paths)) throw new ConcordError('AnalysisSourceChanged', `Analysis membership changed: ${prefix}`);
      }
      if (worktreeIdentity(reader, true, runtime.env) !== captured.identity.candidate) throw new ConcordError('AnalysisSourceChanged', 'Analysis candidate changed');
      captured.native.verifyInputs();
    }) };
  }
  finally { reader.close(); }
}

const readCapture = Effect.fn('analysis.capture')(function*(root: string) {
  const runtime = (yield* OwnedProcess).environment;
  const reader = yield* openReadRepository(root, { access: 'read' });
  return yield* sync(async () => (await captureReader(reader, runtime)));
});

function publishObservations(repo: Repository, values: readonly AnalysisObservation[]): void {
  try {
    writeCachePayloads(PersistentCache.repository(repo), 'code_cache', values.map(value => ({ key: unitKey(repo, value.value.analyzer), payload: JSON.stringify(value) })));
  }
  finally { closeRepositoryCache(repo); }
}

// @concord-end

/** Observation ownership encloses processes; snapshots and publication coordination never enclose waits. */
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md#主流程
export const analyzeCode = (repo: LocalRepository) => Effect.gen(function* () {
  const owned = yield* OwnedProcess;
  const environment = owned.environment.env;
  const run = yield* Effect.acquireRelease(sync(() => {
    PersistentCache.repository(repo).prepareWrite({ create: true });
    closeRepositoryCache(repo);
    const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'analysis-start', true, false, environment)!;
    try { return beginRun(repo.root, environment); }
    finally { releaseTraceLeaseSync(lease, 'analysis-start'); }
  }), run => Effect.gen(function* () {
    yield* owned.awaitIdle;
    const idle = (yield* owned.activeCount) === 0;
    const results = yield* owned.cleanupResults;
    yield* Effect.sync(() => {
      try {
        const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'analysis-finish', true, false, environment)!;
        try {
          const cleanupOk = idle && results.every(hasConfirmedOwnedGroupCleanup);
          finalizeRun(repo.root, run, cleanupOk, environment);
          if (cleanupOk) finishRun(repo.root, run, environment);
        } finally { releaseTraceLeaseSync(lease, 'analysis-finish'); }
      } catch { quarantineRun(repo.root, run, environment); }
    });
  }));
  // Observation cleanup is registered before capturing, so capture failure releases ownership.
  const captured = yield* readCapture(repo.root);
  if (captured.identity.config !== repo.configSnapshot.digest) return yield* Effect.fail(new ConcordError('AnalysisSourceChanged', 'Analysis configuration changed before capture'));
  yield* sync(() => {
    let previous;
    try { previous = readStoredAnalysisObservations(repo); }
    finally { closeRepositoryCache(repo); }
    if (previous.length > 0) publishObservations(repo, previous.map(value => ({ ...value, current: false, complete: false, gaps: [...new Set([...value.gaps, 'SnapshotNotCurrent'])] })));
  });
  const values: AnalysisValue[] = [yield* sync(async () => (await typescriptDependencies(repo, captured.files, captured.trace.annotations.cases, captured.trace.codeDeclarations)))];
  for (const server of repo.config.languageServers ?? []) {
    values.push(yield* analyzeLanguageServer(repo, server, captured.files, captured.trace.annotations.cases, captured.trace.codeDeclarations, captured.native));
  }
  const idle = (yield* owned.activeCount) === 0;
  const results = yield* owned.cleanupResults;
  if (!idle || !results.every(hasConfirmedOwnedGroupCleanup)) return yield* Effect.fail(new ConcordError('AnalysisCleanupUnknown', 'Analysis process group or output pipes remain unconfirmed; observation is quarantined'));
  // Step 5 closes all source and HawDB handles before the short publication section.
  const after = yield* readCapture(repo.root).pipe(Effect.mapError(() => new ConcordError('AnalysisSourceChanged', 'Analysis inputs changed before final verification')));
  if (after.inputs !== captured.inputs) return yield* Effect.fail(new ConcordError('AnalysisSourceChanged', 'Analysis inputs changed', { changed: Object.keys(captured.identity).filter(key => objectDigest(Reflect.get(captured.identity,key)) !== objectDigest(Reflect.get(after.identity,key))) }));
  return yield* sync(() => {
    const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'analysis-publish', true, false, environment)!;
    try {
      // Full native/domain capture has closed. Under ownership, replay only its
      // frozen filesystem preimages; coordinated source writes invalidate the run.
      try { after.verifyFiles(); }
      catch { throw new ConcordError('AnalysisSourceChanged', 'Analysis inputs changed at publication'); }
      const invalidated = finalizeRun(repo.root, run, true, environment);
      if (invalidated) throw new ConcordError('AnalysisSourceChanged', 'Analysis run was invalidated');
      // Currency describes verified repository inputs; external uncertainty stays in gaps.
      const observations = values.map(value => observation(value, captured.inputs, value.gaps, true, new Date().toISOString()));
      publishObservations(repo, observations);
      return { operation: 'code-analyze', observations };
    } finally { releaseTraceLeaseSync(lease, 'analysis-publish'); }
  });
}).pipe(Effect.scoped, Effect.mapError(failure), Effect.catchDefect(cause => Effect.fail(failure(cause))));

// @concord-end

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md#配置与结果
function readStoredAnalysisObservations(repo: Repository): readonly AnalysisObservation[] {
  const analyzers = ['typescript', ...(repo.config.languageServers ?? []).map(server => server.id)];
  const stored = readCachePayloads(PersistentCache.repository(repo), 'code_cache', analyzers.map(analyzer => unitKey(repo, analyzer)));
  const observations: AnalysisObservation[] = [];
  for (const analyzer of analyzers) {
    const payload = stored.get(unitKey(repo, analyzer));
    if (payload === undefined) continue;
    const value = decode(Schema.fromJsonString(AnalysisObservationSchema), payload, 'analysis observation');
    if (value.value.analyzer !== analyzer) throw new ConcordError('InvalidData', 'analysis observation analyzer does not match its cache key');
    if (value.complete !== (value.gaps.length === 0)) throw new ConcordError('InvalidData', 'analysis observation completeness does not match its gaps');
    observations.push(value);
  }
  return observations;
}


/** Missing observations are absent; valid stale observations remain explicitly non-current. */
export async function readAnalysisObservations(repo: Repository, runtime: RuntimeEnvironmentSnapshot = repositoryRuntime(repo)): Promise<readonly AnalysisObservation[]> {
  const observations = readStoredAnalysisObservations(repo);
  if (observations.length === 0) return [];
  const { inputs } = await captureAnalysisInputs(repo, runtime);
  return observations.map(value => ({ ...value, current: value.current && value.inputs === inputs, complete: value.complete && value.inputs === inputs, gaps: value.inputs === inputs ? value.gaps : [...new Set([...value.gaps, 'SnapshotNotCurrent'])] }));
}
