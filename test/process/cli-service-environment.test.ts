// 跨进程保证：运行环境——长期 compute、独立历史扫描与 outbound LSP 保留每次调用的完整环境与 caller cwd。
// 跨进程保证：原生模块与句柄——相对 XDG 从 caller cwd 选择真实 native artifact，A→B→A 不复用另一调用的选择。
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Effect, Schema, Stream } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { nativeArtifactRoot } from '../../src/base/installation/index.ts';
import { AnalysisObservationSchema } from '../../src/model/index.ts';
import { connectWorkspaceSocket, subscribeWorkspace } from '../../src/entry/server/index.ts';
import { runCli, type CliResult } from '../support/cli.ts';
import { createConsumer, retainConsumer } from '../support/consumer.ts';
import { consumer as lspConsumer } from '../support/lsp-analysis-source-fixture.ts';
import { pollUntil, readProjectConfig, writeProjectConfig } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

const Audit = Schema.Struct({
  kind: Schema.Literals(['git', 'native', 'lsp']), pid: Schema.Int, ppid: Schema.Int, cwd: Schema.String,
  entry: Schema.optional(Schema.String), binary: Schema.optional(Schema.String), operation: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)), value: Schema.optional(Schema.NullOr(Schema.String)),
  home: Schema.optional(Schema.NullOr(Schema.String)), xdg: Schema.optional(Schema.NullOr(Schema.String)),
  forbidden: Schema.optional(Schema.NullOr(Schema.String)), language: Schema.optional(Schema.NullOr(Schema.String)), locale: Schema.optional(Schema.NullOr(Schema.String)),
});
type Audit = typeof Audit.Type;
const decodeAudit = Schema.decodeUnknownSync(Schema.fromJsonString(Audit), { onExcessProperty: 'error' });
const decodeError = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })), { onExcessProperty: 'ignore' });
const decodeAnalysis = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ observations: Schema.Array(AnalysisObservationSchema) })), { onExcessProperty: 'ignore' });

function succeeded(result: CliResult): void {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
}

/** Audit only real external Git and native filesystem/loading boundaries. */
function auditFixture(gitAndNative = true) {
  const directory = mkdtempSync(join(tmpdir(), 'concord-service-environment-'));
  const audit = join(directory, 'audit.jsonl');
  writeFileSync(audit, '');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  const realGit = (process.env.PATH ?? '').split(delimiter).map(part => join(part, 'git')).find(existsSync);
  assert.ok(realGit, 'the test forwards to the real Git executable');
  const bin = join(directory, 'bin'); mkdirSync(bin);
  const git = join(bin, 'git');
  const auditedGit = join(bin, 'git-audit');
  symlinkSync(realpathSync(realGit), git);
  writeFileSync(auditedGit, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ kind: 'git', pid: process.pid, ppid: process.ppid, cwd: process.cwd(), args: process.argv.slice(2), value: process.env.CONCORD_CALLER_VALUE ?? null, home: process.env.HOME ?? null, xdg: process.env.XDG_CACHE_HOME ?? null }) + '\\n');
const result = spawnSync(${JSON.stringify(realpathSync(realGit))}, process.argv.slice(2), { env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
`);
  chmodSync(auditedGit, 0o755);
  const loader = join(directory, 'native-audit.ts');
  writeFileSync(loader, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const append = fs.appendFileSync;
const record = (binary: string, operation: string) => append(${JSON.stringify(audit)}, JSON.stringify({ kind: 'native', pid: process.pid, ppid: process.ppid, cwd: process.cwd(), entry: process.argv[1], args: process.argv.slice(2), binary, operation }) + '\\n');
fs.statSync = new Proxy(fs.statSync, { apply(target, receiver, args) {
  const result = Reflect.apply(target, receiver, args);
  if (String(args[0]).endsWith('/hawdb.node')) record(String(args[0]), 'stat');
  return result;
} });
process.dlopen = new Proxy(process.dlopen, { apply(target, receiver, args) {
  const result = Reflect.apply(target, receiver, args);
  if (String(args[1]).endsWith('/hawdb.node')) record(String(args[1]), 'load');
  return result;
} });
syncBuiltinESMExports();
`);
  const source = nativeArtifactRoot(makeRuntimeEnvironment(process.cwd(), process.env));
  assert.equal(existsSync(source), true, 'the current digest native artifact must already be prepared');
  const callers = ['A', 'B'].map(name => {
    const cwd = join(directory, name); mkdirSync(cwd);
    const cache = join(cwd, 'cache');
    const native = join(cache, 'concord/native', basename(source));
    mkdirSync(native, { recursive: true }); cpSync(source, native, { recursive: true });
    return { name, cwd, cache, native };
  });
  const base: NodeJS.ProcessEnv = {
    ...process.env, PATH: gitAndNative ? `${bin}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
    NODE_OPTIONS: gitAndNative ? `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(loader).href}`.trim() : process.env.NODE_OPTIONS,
    NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: undefined,
  };
  const environment = (index: number): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...base, CONCORD_CALLER_VALUE: callers[index]!.name, XDG_CACHE_HOME: 'cache' };
    delete env.HOME; delete env.USERPROFILE;
    return env;
  };
  const records = () => readFileSync(audit, 'utf8').split('\n').filter(Boolean).map(line => decodeAudit(line));
  /** A filesystem notification follows an actual child write, never an elapsed delay. */
  const wait = (predicate: (rows: readonly Audit[]) => boolean, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const watcher = watch(audit, check);
    function close() { watcher.close(); signal.removeEventListener('abort', abort); }
    function abort() { close(); reject(signal.reason); }
    function check() {
      try { if (predicate(records())) { close(); resolve(); } }
      catch (cause) { close(); reject(cause); }
    }
    watcher.once('error', cause => { close(); reject(cause); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else check();
  });
  return { directory, audit, callers, base, environment, records, wait, activateGit: () => renameSync(auditedGit, git) };
}

async function stop(root: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!existsSync(join(root, '.git/concord/server/current.json'))) return;
  succeeded(await runCli({ argv: ['--root', root, '--json', 'server', 'stop'], cwd, env }));
  assert.equal(existsSync(join(root, '.git/concord/server/current.json')), false, 'service ownership is released before deleting the fixture');
}

async function ready(root: string, signal: AbortSignal): Promise<void> {
  const instance = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ token: Schema.String, installation: Schema.String, socket: Schema.Struct({ path: Schema.String }) })), { onExcessProperty: 'ignore' })(readFileSync(join(root, '.git/concord/server/current.json'), 'utf8'));
  const event = Schema.decodeUnknownSync(Schema.Struct({ sourceDigest: Schema.NullOr(Schema.String) }), { onExcessProperty: 'ignore' });
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const connection = yield* connectWorkspaceSocket(instance.socket.path, instance.installation, instance.token);
    yield* subscribeWorkspace(connection).pipe(Stream.filter(value => event(value).sourceDigest !== null), Stream.take(1), Stream.runDrain);
  })), { signal });
}

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('live queries and independent historical scans preserve A→B→A caller environments and cwd', async t => {
  const root = createConsumer(), fixture = auditFixture();
  const startup = { ...fixture.base, HOME: join(fixture.directory, 'service-home'), CONCORD_CALLER_VALUE: 'service-owner', XDG_CACHE_HOME: fixture.callers[0]!.cache };
  try {
    writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
    succeeded(await runCli({ argv: ['--root', root, '--json', 'server', 'start'], cwd: fixture.callers[0]!.cwd, env: startup, signal: t.signal }));
    await ready(root, t.signal);
    fixture.activateGit();
    let computePid: number | undefined;
    let first: CliResult | undefined;
    for (const index of [0, 1, 0]) {
      const caller = fixture.callers[index]!, offset = fixture.records().length;
      const result = await runCli({ argv: ['--root', root, '--json', 'config', 'show'], cwd: caller.cwd, env: fixture.environment(index), signal: t.signal });
      succeeded(result);
      if (first === undefined) first = result; else assert.deepEqual(result, first);
      const rows = fixture.records().slice(offset);
      const native = rows.filter(row => row.kind === 'native' && row.entry?.endsWith('/compute-worker.ts') && row.args?.at(-1) === 'foreground');
      assert.ok(native.some(row => row.binary?.startsWith(`${caller.native}/`)), `${caller.name}: compute checks the native artifact under the caller-relative cache`);
      computePid ??= native[0]!.pid;
      assert.ok(native.every(row => row.pid === computePid), `queries reuse the same actual compute process: expected ${computePid}, observed ${JSON.stringify(native)}`);
      const git = rows.filter(row => row.kind === 'git' && row.ppid === computePid);
      assert.ok(git.length > 0, 'the compute really invokes Git while opening the repository');
      for (const row of git) {
        assert.equal(row.value, caller.name, 'the real Git child inherits this query environment');
        assert.equal(row.home, null, 'absent request HOME cannot fall back to the service owner');
        assert.equal(row.xdg, 'cache');
      }
    }
    for (const caller of fixture.callers) assert.ok(fixture.records().some(row => row.kind === 'native' && row.operation === 'load' && row.pid === computePid && row.binary?.startsWith(`${caller.native}/`)), `${caller.name}: the live compute actually loads the selected binary`);
    for (const [sequence, index] of [0, 1, 0].entries()) {
      const caller = fixture.callers[index]!;
      // Clear drains accepted refreshes and removes prior projections, so this
      // caller must execute a scan rather than reuse a newer queued result.
      succeeded(await runCli({ argv: ['--root', root, '--json', 'cache', 'clear'], cwd: caller.cwd, env: fixture.environment(index), signal: t.signal }));
      const offset = fixture.records().length;
      const value = `${caller.name}:${sequence}`;
      const result = await runCli({ argv: ['--root', root, '--json', 'trace', 'gaps'], cwd: caller.cwd, env: { ...fixture.environment(index), CONCORD_CALLER_VALUE: value }, signal: t.signal });
      if (result.exitCode === 0) {
        const value = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ projection: Schema.Struct({ refresh: Schema.Literal('requested') }) })), { onExcessProperty: 'ignore' })(result.stdout);
        assert.equal(value.projection.refresh, 'requested');
      } else {
        assert.equal(result.exitCode, 1); assert.equal(result.stdout, '');
        assert.equal(decodeError(result.stderr).error, 'QueryPending', result.stderr);
      }
      // Historical hydration never opens LocalRepository. Audit the independent
      // scanner rather than treating a foreground query as its completion fence.
      const scannerPids = (rows: readonly Audit[]) => new Set(rows.filter(row => row.kind === 'native' && row.entry?.endsWith('/query-scan-worker.ts') && row.binary?.startsWith(`${caller.native}/`)).map(row => row.pid));
      // The previous request may still have a follow-up refresh. A distinct
      // caller value correlates this scan without mistaking that work for it.
      await fixture.wait(records => {
        const rows = records.slice(offset), pids = scannerPids(rows);
        return rows.some(row => row.kind === 'git' && row.value === value && pids.has(row.ppid) && row.args?.includes('--show-toplevel'));
      }, t.signal);
      const started = fixture.records().slice(offset), pids = scannerPids(started);
      const scanPid = started.find(row => row.kind === 'git' && row.value === value && pids.has(row.ppid) && row.args?.includes('--show-toplevel'))!.ppid;
      assert.notEqual(scanPid, computePid, 'historical refresh does not occupy the foreground process');
      await pollUntil(async () => {
        try { process.kill(scanPid, 0); return undefined; } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return true;
          throw cause;
        }
      }, { description: 'the audited historical scan exits before checking its complete environment observations' });
      const rows = fixture.records().slice(offset);
      const git = rows.filter(row => row.kind === 'git' && row.ppid === scanPid);
      assert.ok(git.length > 0);
      for (const row of git) { assert.equal(row.value, value); assert.equal(row.home, null); assert.equal(row.xdg, 'cache'); }
      assert.ok(git.some(row => row.args?.includes('--show-toplevel')), 'the independent scan really opens the repository');
      assert.ok(rows.some(row => row.kind === 'native' && row.pid === scanPid && row.binary?.startsWith(`${caller.native}/`)), 'the historical scan itself selects the caller-relative native artifact');
    }
  } finally {
    try { await stop(root, fixture.callers[0]!.cwd, startup); }
    catch (cause) { retainConsumer(root); throw cause; }
    rmSync(root, { recursive: true, force: true }); rmSync(fixture.directory, { recursive: true, force: true });
  }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('outbound LSP receives each code analyze caller allowlist without restoring HOME or other host fields', async t => {
  const root = lspConsumer(), fixture = auditFixture(false);
  const startup = { ...fixture.base, XDG_CACHE_HOME: fixture.callers[0]!.cache };
  try {
    renameSync(join(root, 'server.mjs'), join(root, 'server-actual.mjs'));
    writeFileSync(join(root, 'lsp-audit.ts'), `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(fixture.audit)}, JSON.stringify({ kind: 'lsp', pid: process.pid, ppid: process.ppid, cwd: process.cwd(), value: process.env.LANG ?? null, home: process.env.HOME ?? null, forbidden: process.env.CONCORD_NOT_FOR_LSP ?? null, language: process.env.LANG ?? null, locale: process.env.LC_ALL ?? null }) + '\\n');
await import('./server-actual.mjs');
`);
    const config = readProjectConfig(root), server = config.languageServers![0]!;
    writeProjectConfig(root, { ...config, languageServers: [{ ...server, argv: [process.execPath, 'lsp-audit.ts'], environment: ['LANG', 'LC_ALL'], implementationFiles: ['lsp-audit.ts', 'server-actual.mjs'] }] });
    for (const index of [0, 1, 0]) {
      const caller = fixture.callers[index]!, offset = fixture.records().length;
      const env: NodeJS.ProcessEnv = { ...fixture.environment(index), LANG: caller.name, CONCORD_NOT_FOR_LSP: 'must-be-filtered' };
      delete env.LC_ALL;
      const result = await runCli({ argv: ['--root', root, '--json', 'code', 'analyze'], cwd: caller.cwd, env, signal: t.signal });
      succeeded(result);
      assert.ok(decodeAnalysis(result.stdout).observations.some(observation => observation.value.analyzer === 'python-fixture'), 'the audited server completes real language analysis');
      const reports = fixture.records().slice(offset).filter(row => row.kind === 'lsp');
      assert.equal(reports.length, 1, 'each real analysis starts one audited outbound server');
      assert.equal(reports[0]!.cwd, root, 'configured LSP cwd remains repository-relative');
      assert.equal(reports[0]!.value, caller.name);
      assert.equal(reports[0]!.home, null, 'absent HOME remains absent at the outbound server');
      assert.equal(reports[0]!.forbidden, null, 'non-allowlisted caller variables stay out');
      assert.equal(reports[0]!.language, caller.name);
      assert.equal(reports[0]!.locale, null, 'an allowlisted field absent from this caller stays absent');
    }
  } finally {
    try { await stop(root, fixture.callers[0]!.cwd, startup); }
    catch (cause) { retainConsumer(root); throw cause; }
    rmSync(root, { recursive: true, force: true }); rmSync(fixture.directory, { recursive: true, force: true });
  }
});
