import { randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { closeRepositoryCache, withPersistentCache } from './cache-store.js';
import { acquireTraceLeaseSync, releaseTraceLeaseSync, ensureGenericPrivateDirectorySync } from './coordination.js';
import { hasConfirmedOwnedGroupCleanup, hasSuccessfulOwnedProcessResult, OwnedProcess, runOwnedProcess, type OwnedProcessResult } from './owned-process.js';
import { observation, observationSchema, type Observation } from './observation.js';
import { beginRun, finalizeRun, finishRun, quarantineRun } from './run-coordination.js';
import { ConcordError, canonical, decode, digest, failure, objectDigest, Text, type AnnotatedCase, type Repository } from './shared.js';
import type { LocalRepository } from './storage.js';
import { inPath, type TestAdapter } from './test-adapter-config.js';
import { bindNative } from './test-adapter-binding.js';
import { builtinCollectParse, builtinCollectPlan, builtinReportParse, builtinSelectPlan, builtinVersionCommand } from './test-adapter-builtins.js';
import { ADAPTER_FORMAT, AdapterVersionsSchema, ManifestSchema, PayloadSchemas, PlanSchema, ReportSchema, RequestSchema, protocolDecode, protocolJson, type AdapterContext, type AdapterOp, type AdapterPlan, type AdapterReport, type AdapterVersions, type Captured, type NativeManifest, type ProcessStatus } from './test-adapter-protocol.js';
import { readReports, reportPath, type ReportBudget } from './test-adapter-reports.js';

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md#约束
export const adapterFor = (repo: Repository, file: string): TestAdapter | undefined => repo.config.testAdapters?.find(adapter => adapter.include.some(root => inPath(file, root)));
export function adapterImplementation(): string {
  const root = dirname(fileURLToPath(import.meta.url)); const entries: { path: string; digest: string }[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const target = join(directory, name); const path = prefix ? `${prefix}/${name}` : name; const stat = lstatSync(target);
      if (stat.isSymbolicLink()) throw new ConcordError('UnsafeToolInstallation', 'Concord implementation contains a symbolic link');
      if (stat.isDirectory()) walk(target, path);
      else if (stat.isFile() && /\.[cm]?js$/u.test(name)) entries.push({ path, digest: digest(inputBytes(target)) });
    }
  };
  walk(root, ''); return objectDigest(entries);
}
const ObservationSchema = observationSchema(ManifestSchema);
const InputScopeSchema = Schema.Struct({ inputs: Text, members: Schema.Array(Schema.Struct({ path: Text, digest: Text })), excluded: Schema.Array(Text), versions: AdapterVersionsSchema });
const CACHE_PREFIX = 'native-manifest/v1/';
const INPUT_PREFIX = 'native-inputs/v1/';
function inputBytes(path: string): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new ConcordError('InputChanged', 'Adapter input is not a regular file');
  const descriptor = openSync(path, constants.O_RDONLY | (process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW) | constants.O_NONBLOCK);
  try {
    if (process.platform === 'linux' && readlinkSync(`/proc/self/fd/${descriptor}`) !== path) throw new ConcordError('InputChanged', 'Adapter input resolved outside its captured path');
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new ConcordError('InputChanged', 'Adapter input was replaced while opening');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor); const linked = lstatSync(path);
    if (linked.isSymbolicLink() || linked.ino !== opened.ino || linked.dev !== opened.dev || after.size !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new ConcordError('InputChanged', 'Adapter input changed while reading');
    return bytes;
  } finally { closeSync(descriptor); }
}
function executable(command: string, root: string): string {
  const candidates = command.includes('/') ? [resolve(root, command)] : (process.env.PATH ?? '').split(delimiter).map(path => join(path, command));
  const found = candidates.find(path => existsSync(path) && lstatSync(path).isFile());
  // Runtime executables are installation inputs and may be links (e.g. Nix and rustup).
  const linked = candidates.find(path => { try { return readFileSync(path).length > 0; } catch { return false; } });
  if (!found && !linked) throw new ConcordError('CollectFailed', `Adapter executable is unavailable: ${command}`);
  return found ?? linked!;
}
export function adapterInputSnapshot(repo: Repository, adapter: TestAdapter): { inputs: string; members: readonly { path: string; digest: string }[]; excluded: readonly string[] } {
  // The input contract is conservative over every declared source/test/input root,
  // repository-level configuration, and explicitly named implementation/lock files.
  const paths = new Set(readdirSync(repo.root).filter(path => path !== '.git' && path !== 'node_modules' && path !== 'AGENTS.md' && lstatSync(join(repo.root, path)).isFile()));
  for (const root of [...repo.config.testRoots, ...(repo.config.sourceRoots ?? []), ...adapter.inputRoots]) {
    for (const path of repo.files(root)) if (!(repo.config.sourceIgnore ?? []).some(ignored => inPath(path, ignored))) paths.add(path);
  }
  for (const path of [...repo.config.runner.sourceFiles, ...adapter.implementationFiles, ...adapter.lockFiles, 'concord.config.ts']) paths.add(path);
  const members = [...paths].sort().map(path => {
    const target = repo.absolute(path);
    if (!existsSync(target)) return { path, digest: digest('concord:absent') };
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ConcordError('AdapterProtocolInvalid', `Input is not a regular repository file: ${path}`);
    return { path, digest: digest(inputBytes(target)) };
  });
  for (const path of [...adapter.implementationFiles, ...adapter.lockFiles]) if (!members.some(member => member.path === path) || !existsSync(repo.absolute(path))) throw new ConcordError('CollectFailed', `A declared adapter input is missing: ${path}`);
  const argv = adapter.argv ?? builtinVersionCommand(adapter);
  if (adapter.argv && argv[0] && ['node', process.execPath].includes(argv[0])) {
    const script = argv.find((part, index) => index > 0 && !part.startsWith('-') && /\.[cm]?[jt]s$/u.test(part));
    if (script && !adapter.implementationFiles.includes(script)) throw new ConcordError('AdapterProtocolInvalid', 'The executed adapter script must be included in implementationFiles');
  }
  const command = executable(argv[0]!, repo.root);
  const env = Object.fromEntries(adapter.envNames.map(name => [name, process.env[name] ?? null]));
  const excluded = ['.git', '**/node_modules', 'AGENTS.md', ...(repo.config.sourceIgnore ?? [])];
  const inputs = objectDigest({ algorithm: 'concord-native-inputs/v2', root: repo.root, projectId: repo.config.projectId, config: repo.configSnapshot.digest, adapter, implementation: adapterImplementation(), members, excluded, executable: { path: command, digest: digest(readFileSync(command)) }, runtime: process.version, env });
  return { inputs, members, excluded };
}
function safeEnvironment(names: readonly string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(names.filter(name => !name.startsWith('GIT_') && name !== 'NODE_TEST_CONTEXT').flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
}
function status(invocationId: string, value: OwnedProcessResult): ProcessStatus {
  return { invocationId, exitCode: value.error === undefined ? value.exitCode : null, signal: value.signal, timedOut: value.timedOut, cancelled: value.cancelled, outputTruncated: value.outputLimitExceeded, cleanup: hasConfirmedOwnedGroupCleanup(value) ? 'complete' : 'unknown' };
}
interface Session { readonly runId: string; readonly directory: string; readonly deadline: number; cleanupKnown: boolean; readonly reportBudget: ReportBudget; readonly reportErrors: string[]; }
const sync = <A>(use: () => A) => Effect.try({ try: use, catch: failure });
const withSession = <A>(repo: LocalRepository, adapters: readonly TestAdapter[], use: (session: Session) => Effect.Effect<A, ConcordError, OwnedProcess>, publish?: (value: A) => void): Effect.Effect<A, ConcordError, OwnedProcess> => Effect.gen(function* () {
  const service = yield* OwnedProcess;
  const owned = yield* Effect.acquireRelease(sync(() => repo.snapshot(() => {
    ensureGenericPrivateDirectorySync(repo.root, repo.privateDir);
    const directory = mkdtempSync(join(repo.privateDir, 'adapter-reports-'));
    try {
      const run = beginRun(repo.root);
      const session: Session = { runId: randomUUID(), directory, deadline: Date.now() + Math.min(...adapters.map(adapter => adapter.wallTimeoutMs ?? 600_000), 600_000), cleanupKnown: true, reportBudget: { files: 0, bytes: 0 }, reportErrors: [] };
      return { run, session };
    } catch (cause) { rmSync(directory, { recursive: true, force: true }); throw cause; }
  })), owned => Effect.gen(function* () {
    const results = yield* service.cleanupResults;
    const idle = (yield* service.activeCount) === 0;
    yield* Effect.sync(() => {
      try {
        let cleanup = owned.session.cleanupKnown && idle && results.every(hasConfirmedOwnedGroupCleanup);
        if (cleanup) {
          try { rmSync(owned.session.directory, { recursive: true, force: true }); } catch { cleanup = false; }
        }
        const lease = acquireTraceLeaseSync(repo.root, 'exclusive', 'adapter-finalize')!;
        try {
          finalizeRun(repo.root, owned.run, cleanup);
          if (cleanup) finishRun(repo.root, owned.run); else { quarantineRun(repo.root, owned.run); throw new ConcordError('CleanupUnknown', `Adapter cleanup is unconfirmed; preserve ${owned.session.directory} and runner ownership`); }
        } finally { releaseTraceLeaseSync(lease, 'adapter-finalize'); }
      } catch (cause) { quarantineRun(repo.root, owned.run); throw cause; }
    });
  }));
  const value = yield* use(owned.session);
  yield* sync(() => {
    // Report files have no remaining users before publication can authorize a result.
    try { rmSync(owned.session.directory, { recursive: true, force: true }); } catch { owned.session.cleanupKnown = false; throw new ConcordError('CleanupUnknown', 'Could not remove adapter report directories'); }
    if (Date.now() > owned.session.deadline) throw new ConcordError('CollectFailed', 'Adapter run exceeded its wall time budget');
    repo.snapshot(() => {
      const invalidated = finalizeRun(repo.root, owned.run, owned.session.cleanupKnown);
      if (invalidated) throw new ConcordError('InputChanged', 'The run epoch was invalidated during adapter execution');
      publish?.(value);
    });
  });
  return value;
}).pipe(Effect.scoped, Effect.mapError(error => ['PreimageChanged', 'SourceChanged'].includes(error.code) ? new ConcordError('InputChanged', error.message) : error), Effect.catchDefect(cause => Effect.fail(failure(cause))));

const callProcess = Effect.fn('testAdapter.process')(function* (repo: Repository, adapter: TestAdapter, session: Session, argv: readonly string[], options: { cwd?: string; stdin?: string; timeout?: number; envNames?: readonly string[] } = {}) {
  const remaining = session.deadline - Date.now();
  if (remaining <= 0) return yield* Effect.fail(new ConcordError('CollectFailed', 'Adapter run wall time budget expired'));
  const value = yield* runOwnedProcess(argv, { cwd: options.cwd ?? repo.root, env: { ...safeEnvironment(options.envNames ?? adapter.envNames), ...(adapter.builtin === 'pytest' ? { PYTHONDONTWRITEBYTECODE: '1' } : {}) }, stdin: options.stdin, timeoutMs: Math.max(1, Math.min(remaining, options.timeout ?? adapter.collectTimeoutMs ?? 60_000)), outputLimitBytes: adapter.budgets?.outputBytes ?? 16 * 1024 * 1024 }).pipe(Effect.scoped, Effect.mapError(failure));
  if (!hasConfirmedOwnedGroupCleanup(value)) { session.cleanupKnown = false; return yield* Effect.fail(new ConcordError('CleanupUnknown', 'Owned adapter process group cleanup is unknown')); }
  return value;
});
const exchange = Effect.fn('testAdapter.exchange')(function* <A>(repo: Repository, adapter: TestAdapter, session: Session, context: AdapterContext, op: AdapterOp, payload: unknown, resultSchema: Schema.ConstraintDecoder<A, never>) {
  const request = yield* sync(() => protocolDecode(RequestSchema, { format: ADAPTER_FORMAT, op, requestId: randomUUID(), context, payload: protocolDecode(PayloadSchemas[op] as Schema.ConstraintDecoder<unknown, never>, payload) }));
  const result = yield* callProcess(repo, adapter, session, adapter.argv!, { stdin: `${canonical(request)}\n` });
  if (!hasSuccessfulOwnedProcessResult(result)) return yield* Effect.fail(new ConcordError('AdapterProtocolInvalid', 'Adapter protocol process did not terminate normally with exit 0'));
  return yield* sync(() => {
    const envelope = Schema.Struct({ format: Schema.Literal(ADAPTER_FORMAT), op: Schema.Literal(op), requestId: Text, planId: Text, inputs: Text, payload: resultSchema });
    const response = protocolDecode(envelope, protocolJson(result.stdout, adapter.budgets?.responseBytes));
    if (response.requestId !== request.requestId || response.planId !== context.planId || response.inputs !== context.inputs) throw new ConcordError('AdapterProtocolInvalid', 'Response identity does not match its current request/plan/input');
    return response.payload;
  });
});
const executePlan = Effect.fn('testAdapter.executePlan')(function* (repo: Repository, adapter: TestAdapter, session: Session, context: AdapterContext, plan: AdapterPlan, collecting: boolean, requested?: readonly string[]) {
  yield* sync(() => {
    if (plan.invocations.length > (adapter.budgets?.invocations ?? 128) || new Set(plan.invocations.map(item => item.invocationId)).size !== plan.invocations.length) throw new ConcordError('AdapterProtocolInvalid', 'Invocation count exceeds the budget or IDs are repeated');
    const assigned: string[] = [];
    for (const item of plan.invocations) {
      if (!/^[A-Za-z0-9_-]+$/u.test(item.invocationId) || item.envNames.some(name => !adapter.envNames.includes(name)) || item.argv.some(argument => argument.includes('\0'))) throw new ConcordError('AdapterProtocolInvalid', 'Unsafe invocation identity, arguments or environment');
      if (item.cwd !== '.') { reportPath(item.cwd); repo.absolute(item.cwd); }
      item.reports.forEach(reportPath);
      if (!collecting) {
        if (!item.requested?.length || item.requested.some(id => !requested?.includes(id))) throw new ConcordError('AdapterProtocolInvalid', 'Each select invocation must own a nonempty requested subset');
        assigned.push(...item.requested);
      }
    }
    if (!collecting && (new Set(assigned).size !== assigned.length || assigned.length !== requested?.length)) throw new ConcordError('AdapterProtocolInvalid', 'Selection invocation subsets do not partition requested IDs exactly once');
  });
  const captures: Captured[] = [];
  for (const item of plan.invocations) {
    const directory = join(context.reportDirectory, item.invocationId);
    yield* sync(() => mkdirSync(directory, { recursive: false, mode: 0o700 }));
    const result = yield* callProcess(repo, adapter, session, item.argv, { cwd: item.cwd === '.' ? repo.root : repo.absolute(item.cwd), envNames: item.envNames, timeout: collecting ? adapter.collectTimeoutMs ?? 60_000 : adapter.runTimeoutMs ?? 300_000 });
    if (collecting && !hasSuccessfulOwnedProcessResult(result)) return yield* Effect.fail(new ConcordError('CollectFailed', 'A native collection invocation did not exit normally with code 0'));
    const reports = yield* sync(() => readReports(directory, item.reports, adapter, session.reportBudget)).pipe(Effect.catch(error => { if (collecting) return Effect.fail(error); session.reportErrors.push(error.code); return Effect.succeed([]); }));
    captures.push({ status: status(item.invocationId, result), stdout: result.stdout, stderr: result.stderr, reports });
  }
  return captures;
});
function revalidateReports(adapter: TestAdapter, context: AdapterContext, plan: AdapterPlan, captures: readonly Captured[]): void {
  const budget: ReportBudget = { files: 0, bytes: 0 };
  for (const [index, invocation] of plan.invocations.entries()) {
    const reports = readReports(join(context.reportDirectory, invocation.invocationId), invocation.reports, adapter, budget);
    if (canonical(reports.map(report => ({ path: report.path, digest: report.digest }))) !== canonical(captures[index]?.reports.map(report => ({ path: report.path, digest: report.digest })))) throw new ConcordError('ReportUnsafe', 'Report bytes changed after capture or parsing');
  }
}
function validateManifest(repo: Repository, adapter: TestAdapter, files: readonly string[], manifest: NativeManifest): void {
  if (manifest.cases.length > (adapter.budgets?.cases ?? 100_000) || new Set(manifest.cases.map(item => item.nativeId)).size !== manifest.cases.length) throw new ConcordError('AdapterProtocolInvalid', 'Native manifest exceeds its budget or has duplicate IDs');
  const groups = new Map<string, string>();
  for (const item of manifest.cases) {
    if (!files.includes(item.file)) throw new ConcordError('AdapterProtocolInvalid', 'Collected native item is outside the requested files');
    const source = repo.read(item.file);
    if (source === undefined) throw new ConcordError('InputChanged', 'Collected source disappeared');
    if (item.range && (!manifest.capabilities.range || item.range.sourceDigest !== digest(source) || item.range.endLine > source.split(/\r?\n/u).length)) throw new ConcordError('AdapterProtocolInvalid', 'Native declaration range is outside current source');
    if (item.group) {
      if (!manifest.capabilities.parameterGroups) throw new ConcordError('AdapterProtocolInvalid', 'Provider emitted parameter groups without declaring that capability');
      const key = `${item.project}:${item.file}:${item.group}`; const identity = objectDigest(item.range);
      if (groups.has(key) && groups.get(key) !== identity) throw new ConcordError('AdapterProtocolInvalid', 'A parameter group must share its declaration range');
      groups.set(key, identity);
    }
  }
}
// @concord-end
const collectOne = Effect.fn('testAdapter.collect')(function* (repo: LocalRepository, adapter: TestAdapter, files: readonly string[], session: Session) {
  const before = yield* sync(() => repo.snapshot(() => adapterInputSnapshot(repo, adapter)));
  const reportDirectory = join(session.directory, adapter.id);
  yield* sync(() => mkdirSync(reportDirectory, { mode: 0o700 }));
  const context: AdapterContext = { root: repo.root, runId: session.runId, planId: randomUUID(), inputs: before.inputs, reportDirectory };
  const versions: { -readonly [K in keyof AdapterVersions]: AdapterVersions[K] } = { framework: adapter.frameworkVersion, runtime: process.version };
  if (adapter.builtin) {
    const version = yield* callProcess(repo, adapter, session, builtinVersionCommand(adapter));
    if (!hasSuccessfulOwnedProcessResult(version) || !`${version.stdout}\n${version.stderr}`.split(/[\s/]+/u).some(token => token === adapter.frameworkVersion || adapter.builtin === 'node-test' && token === `v${adapter.frameworkVersion}`)) return yield* Effect.fail(new ConcordError('CollectFailed', 'Installed framework version does not match the pinned adapter version'));
    versions.observedFramework = version.stdout.trim() || version.stderr.trim();
    const runtimeCommand = adapter.builtin === 'cargo' ? ['rustc', '+stable', '--version'] : adapter.builtin === 'pytest' ? ['uv', 'run', '--offline', '--no-project', '--with', 'pytest==9.1.1', 'python', '--version'] : undefined;
    if (runtimeCommand) {
      const runtime = yield* callProcess(repo, adapter, session, runtimeCommand);
      if (hasSuccessfulOwnedProcessResult(runtime)) versions.observedRuntime = runtime.stdout.trim() || runtime.stderr.trim();
    } else versions.observedRuntime = adapter.builtin === 'go' ? versions.observedFramework : process.version;
  }
  const plan = adapter.builtin ? yield* sync(() => protocolDecode(PlanSchema, builtinCollectPlan(adapter, context, files))) : yield* exchange(repo, adapter, session, context, 'collect-plan', { files, members: before.members }, PlanSchema);
  const captures = yield* executePlan(repo, adapter, session, context, plan, true);
  const collected = adapter.builtin ? yield* sync(() => protocolDecode(ManifestSchema, builtinCollectParse(adapter, context, files, captures))) : yield* exchange(repo, adapter, session, context, 'collect-parse', { planContext: plan.planContext, captures }, ManifestSchema);
  // Provider completeness covers collection only. System/toolchain/cache inputs
  // remain outside the repository snapshot, including for a trusted provider.
  const manifest: NativeManifest = { ...collected, completeness: { complete: false, gaps: [...new Set([...collected.completeness.gaps, 'ExternalInputUnknown'])] } };
  yield* sync(() => revalidateReports(adapter, context, plan, captures));
  yield* sync(() => repo.snapshot(() => { validateManifest(repo, adapter, files, manifest); if (adapterInputSnapshot(repo, adapter).inputs !== before.inputs) throw new ConcordError('InputChanged', 'Adapter collection inputs or member set changed'); }));
  return { adapter, manifest, context, before, providerComplete: collected.completeness.complete, versions };
});
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md#主流程
export function readNativeObservations(repo: Repository): readonly { adapterId: string; observation: Observation<NativeManifest>; inputScope?: typeof InputScopeSchema.Type }[] {
  const results: { adapterId: string; observation: Observation<NativeManifest>; inputScope?: typeof InputScopeSchema.Type }[] = [];
  for (const adapter of repo.config.testAdapters ?? []) {
    try {
      const item = withPersistentCache(repo, false, database => database?.get('annotation_cache', [`${CACHE_PREFIX}${adapter.id}`])[0]);
      if (!item) continue;
      const value = decode(ObservationSchema, protocolJson(item.payload), 'native manifest observation');
      const current = adapterInputSnapshot(repo, adapter).inputs === value.inputs;
      const scope = withPersistentCache(repo, false, database => database?.get('annotation_cache', [`${INPUT_PREFIX}${adapter.id}`])[0]);
      const inputScope = scope ? decode(InputScopeSchema, protocolJson(scope.payload), 'native input scope') : undefined;
      if (inputScope && inputScope.inputs !== value.inputs) continue;
      results.push({ adapterId: adapter.id, observation: { ...value, current }, ...(inputScope ? { inputScope } : {}) });
    } catch { /* Disposable observations never affect static command success. */ }
  }
  return results;
}
function publishObservations(repo: LocalRepository, results: readonly { adapter: TestAdapter; manifest: NativeManifest; before: ReturnType<typeof adapterInputSnapshot>; versions: AdapterVersions }[]): readonly { adapterId: string; observation: Observation<NativeManifest>; inputScope: typeof InputScopeSchema.Type }[] {
  return repo.snapshot(() => {
    const values = results.map(item => {
      if (adapterInputSnapshot(repo, item.adapter).inputs !== item.before.inputs) throw new ConcordError('InputChanged', 'Inputs changed before native observation publication');
      const value = observation(item.manifest, item.before.inputs, item.manifest.completeness.gaps, true);
      return { adapterId: item.adapter.id, observation: { ...value, complete: item.manifest.completeness.complete }, inputScope: { ...item.before, versions: item.versions } };
    });
    withPersistentCache(repo, true, database => database!.put('annotation_cache', values.flatMap(value => [{ key: `${CACHE_PREFIX}${value.adapterId}`, payload: canonical(value.observation) }, { key: `${INPUT_PREFIX}${value.adapterId}`, payload: canonical(value.inputScope) }])));
    closeRepositoryCache(repo);
    return values;
  });
}
// @concord-end
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md#主流程
export const collectNativeTests = Effect.fn('collectNativeTests')(function* (repo: LocalRepository, requestedFiles: readonly string[] = []) {
  const adapters = repo.config.testAdapters ?? [];
  const files = yield* sync(() => repo.snapshot(() => requestedFiles.length ? [...new Set(requestedFiles)] : [...new Set(repo.config.testRoots.flatMap(root => repo.files(root, 'source')))].filter(file => adapterFor(repo, file) !== undefined && /(?:\.(?:[cm]?[jt]sx?|py|go|rs))$/u.test(file))));
  yield* sync(() => { for (const file of files) { repo.absolute(file); if (!adapterFor(repo, file)) throw new ConcordError('NativeSelectionUnsupported', `No adapter covers ${file}`); } });
  const results = yield* withSession(repo, adapters, session => Effect.gen(function* () {
    return yield* Effect.forEach(adapters.filter(adapter => files.some(file => adapter.include.some(root => inPath(file, root)))), adapter => collectOne(repo, adapter, files.filter(file => adapter.include.some(root => inPath(file, root))), session), { concurrency: 1 });
  }), results => { publishObservations(repo, results); });
  return { operation: 'test-collect', observations: results.map(item => ({ adapterId: item.adapter.id, observation: { ...observation(item.manifest, item.before.inputs, item.manifest.completeness.gaps, true), complete: item.manifest.completeness.complete }, inputScope: { ...item.before, versions: item.versions } })) };
});
// @concord-end
export interface NativeExecution { readonly adapter: TestAdapter; readonly inputs: string; readonly manifest: NativeManifest; readonly requested: readonly string[]; readonly report: AdapterReport; readonly statuses: readonly ProcessStatus[]; readonly plan: AdapterPlan; readonly planId: string; readonly versions: AdapterVersions; readonly inputScope: ReturnType<typeof adapterInputSnapshot>; }
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md#主流程
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md#约束
export const executeNativeCase = Effect.fn('executeNativeCase')(function* (repo: LocalRepository, marker: AnnotatedCase, requireNative = false, publish?: (execution: NativeExecution) => void) {
  const adapter = adapterFor(repo, marker.file);
  if (!adapter) {
    if (requireNative) return yield* Effect.fail(new ConcordError('NativeSelectionUnsupported', 'This file uses the command runner'));
    return undefined;
  }
  return yield* withSession(repo, [adapter], session => Effect.gen(function* () {
    const collection = yield* collectOne(repo, adapter, [marker.file], session);
    const requested = yield* sync(() => repo.snapshot(() => bindNative(repo, marker, collection.manifest)));
    const caps = collection.manifest.capabilities;
    if (!requested || !caps.realCollection || !caps.exactSelection || !caps.perItemReport || !collection.providerComplete) {
      if (requireNative || marker.native !== undefined) return yield* Effect.fail(new ConcordError('NativeSelectionUnsupported', 'Current collection cannot authorize an exact native selection'));
      return undefined;
    }
    const runDirectory = join(session.directory, `${adapter.id}-selected`);
    yield* sync(() => mkdirSync(runDirectory, { mode: 0o700 }));
    const context = { ...collection.context, reportDirectory: runDirectory, planId: randomUUID() };
    const plan = adapter.builtin ? yield* sync(() => protocolDecode(PlanSchema, builtinSelectPlan(adapter, context, collection.manifest, requested))) : yield* exchange(repo, adapter, session, context, 'select-plan', { nativeIds: requested, manifestInputs: context.inputs, manifest: collection.manifest }, PlanSchema);
    const captures = yield* executePlan(repo, adapter, session, context, plan, false, requested);
    const invalidReport = (gaps: readonly string[]): AdapterReport => ({ observed: [], capabilities: collection.manifest.capabilities, completeness: { complete: false, gaps } });
    const parse = adapter.builtin ? sync(() => protocolDecode(ReportSchema, builtinReportParse(adapter, requested.map(id => collection.manifest.cases.find(item => item.nativeId === id)!), captures))) : exchange(repo, adapter, session, context, 'report-parse', { planContext: plan.planContext, requested, captures }, ReportSchema);
    let report = session.reportErrors.length ? invalidReport(session.reportErrors) : yield* parse.pipe(Effect.catch(error => Effect.succeed(invalidReport([error.code]))));
    yield* sync(() => {
      try { revalidateReports(adapter, context, plan, captures); } catch (cause) { report = invalidReport([failure(cause).code]); }
      if (report.observed.length > (adapter.budgets?.cases ?? 100_000)) report = invalidReport(['AdapterProtocolInvalid']);
    });
    yield* sync(() => repo.snapshot(() => { if (adapterInputSnapshot(repo, adapter).inputs !== collection.before.inputs) throw new ConcordError('InputChanged', 'Native execution inputs or member set changed'); }));
    return { adapter, inputs: collection.before.inputs, manifest: collection.manifest, requested, report, statuses: captures.map(captured => captured.status), plan, planId: context.planId, versions: collection.versions, inputScope: collection.before } satisfies NativeExecution;
  }), execution => {
    if (execution) {
      if (adapterInputSnapshot(repo, adapter).inputs !== execution.inputs) throw new ConcordError('InputChanged', 'Inputs changed before native evidence publication');
      publishObservations(repo, [{ adapter, manifest: execution.manifest, before: execution.inputScope, versions: execution.versions }]);
      publish?.(execution);
    }
  });
});
// @concord-end
