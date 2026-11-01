import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync } from '../../src/base/publication/index.js';
import { installedConcordCli, pollUntil } from '../support/support.js';
import { command, fixture, record, recordPath, rpcModule, stop } from '../support/workspace-server-fixture.js';

function launch(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env, ipc = false) {
  const child = spawn(process.execPath, [installedConcordCli(), ...args], { cwd, env, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout!.on('data', bytes => { stdout += String(bytes); });
  child.stderr!.on('data', bytes => { stderr += String(bytes); });
  const completed = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once(ipc ? 'exit' : 'close', status => resolve({ status, stdout, stderr }));
  });
  return { child, completed };
}
const cli = (root: string, args: readonly string[], env?: NodeJS.ProcessEnv) => launch(root, ['--json', ...args], env).completed;
const gone = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };
const terminate = (child: ChildProcess) => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };

// @feature docs/feature/local-data-engine/README.md
test('queries from two subdirectories automatically share one service and observe later source changes', { timeout: 30_000 }, async () => {
  const root = fixture();
  mkdirSync(join(root, 'a')); mkdirSync(join(root, 'b'));
  try {
    const results = await Promise.all(['a', 'b'].map(directory => cli(join(root, directory), ['check'])));
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const running = record(root);
    assert.equal((await cli(join(root, 'a'), ['server', 'status'])).status, 0);
    assert.equal(record(root).token, running.token);
    writeFileSync(join(root, 'docs/feature/reader/README.md'), '---\nunknownField: true\n---\n# Reader\n');
    const changed = await cli(join(root, 'b'), ['check']);
    assert.equal(changed.status, 1, changed.stderr);
    assert.equal(JSON.parse(changed.stdout).ok, false);
    assert.equal(record(root).token, running.token);
    assert.equal(existsSync(join(root, 'a/.git')), false);
    assert.equal(existsSync(join(root, 'b/.git')), false);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('command query cleanup precedes success and configuration failure, and never stops an existing service', { timeout: 30_000 }, async () => {
  const root = fixture();
  try {
    const success = await cli(root, ['--server=command', 'check']);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    writeFileSync(join(root, 'concord.config.ts'), 'export default (() => ({}))();\n');
    const invalid = await cli(root, ['--server=command', 'check']);
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stderr).error, 'InvalidConfigSyntax');
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const running = record(root);
    const rejected = await cli(root, ['--server=command', 'check']);
    assert.equal(JSON.parse(rejected.stderr).error, 'WorkspaceServerBusy');
    assert.equal(record(root).token, running.token);
    const diagnostic = await cli(root, ['check']);
    assert.equal(JSON.parse(diagnostic.stderr).error, 'InvalidConfigSyntax');
    assert.equal(record(root).token, running.token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('inherited command scopes reject other roots and HTTP, and parent disconnect releases the instance', { timeout: 30_000 }, async () => {
  const root = fixture(), other = fixture();
  const scope = { root, privateDir: genericPrivateDirectorySync(root), key: crypto.randomUUID() };
  const env = { ...process.env, CONCORD_SERVER_SCOPE: JSON.stringify(scope) };
  const server = launch(root, ['server', 'run', '--root', root], env, true);
  try {
    await pollUntil(async () => existsSync(recordPath(root)) ? true : undefined, { description: 'command service publishes its real socket', timeoutMs: 10_000 });
    const running = record(root);
    const accepted = await cli(root, ['check'], env); assert.equal(accepted.status, 0, accepted.stderr);
    const excluded = await cli(root, ['check']); assert.equal(JSON.parse(excluded.stderr).error, 'WorkspaceServerScoped');
    const mismatch = await cli(other, ['check'], env); assert.equal(JSON.parse(mismatch.stderr).error, 'WorkspaceServerScopeMismatch');
    const dryMismatch = await cli(other, ['--dry-run', 'check'], env); assert.equal(JSON.parse(dryMismatch.stderr).error, 'WorkspaceServerScopeMismatch');
    assert.equal(existsSync(recordPath(other)), false);
    const rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token, scope.key);
      const result = yield* Effect.result(rpc.requestWorkspace(connection, 'http', { action: 'open', host: '127.0.0.1', port: 0 }));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal((result.failure as { code: string }).code, 'WorkspaceServerScoped');
    })));
    server.child.disconnect();
    const ended = await server.completed; assert.equal(ended.status, 0, ended.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal(existsSync(running.socket.path), false);
    const expired = await cli(root, ['check'], env); assert.equal(JSON.parse(expired.stderr).error, 'WorkspaceServerScopeExpired');
    assert.equal(existsSync(recordPath(root)), false);
  } finally { terminate(server.child); await server.completed; rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('killing the owning CLI ends its command service through IPC even while a query waits on publication', { timeout: 30_000 }, async () => {
  const root = fixture();
  const lease = acquireTraceLeaseSync(root, 'exclusive', 'query-scope-test')!;
  const owner = launch(root, ['--json', '--server=command', 'check']);
  let running: ReturnType<typeof record> | undefined;
  try {
    await pollUntil(async () => existsSync(recordPath(root)) ? true : undefined, { description: 'owned command service starts', timeoutMs: 10_000 });
    running = record(root);
    owner.child.kill('SIGKILL'); await owner.completed;
    await pollUntil(async () => !existsSync(recordPath(root)) && gone(running!.pid) ? true : undefined, { description: 'owner disconnect stops service and removes its record', timeoutMs: 10_000 });
    assert.equal(existsSync(running.socket.path), false);
  } finally {
    terminate(owner.child); await owner.completed;
    releaseTraceLeaseSync(lease, 'query-scope-test');
    if (running && !gone(running.pid)) process.kill(running.pid, 'SIGTERM');
    rmSync(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/local-data-engine/README.md
test('a warm query process checks native observation identity against each client environment without inheriting credentials', { timeout: 40_000 }, async () => {
  const root = fixture();
  const source = fileURLToPath(new URL('../..', import.meta.url));
  const secret = `query-environment-${crypto.randomUUID()}`;
  const env = { ...process.env, CONCORD_QUERY_FIXTURE: secret };
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/reader/README.md\n// @name query-environment\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    copyFileSync(join(source, 'test/fixtures/process-adapter.ts'), join(root, 'adapter.ts'));
    writeFileSync(join(root, 'mode.txt'), 'green');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH', 'CONCORD_QUERY_FIXTURE'] }] })};\n`);
    const collected = await cli(root, ['test', 'discover'], env); assert.equal(collected.status, 0, collected.stderr);
    const first = await cli(root, ['test', 'list'], env); assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).observations[0].observation.current, true);
    const running = record(root);
    const missing = { ...process.env }; delete missing.CONCORD_QUERY_FIXTURE;
    const second = await cli(root, ['test', 'list'], missing); assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).observations[0].observation.current, false);
    const third = await cli(root, ['test', 'list'], env); assert.equal(third.status, 0, third.stderr);
    assert.equal(JSON.parse(third.stdout).observations[0].observation.current, true);
    assert.equal(record(root).token, running.token);
    assert.equal([first.stdout, second.stdout, third.stdout, readFileSync(recordPath(root), 'utf8')].join('').includes(secret), false);
    const recollected = await cli(root, ['test', 'discover'], missing); assert.equal(recollected.status, 0, recollected.stderr);
    const updated = await cli(root, ['test', 'list'], missing); assert.equal(JSON.parse(updated.stdout).observations[0].observation.current, true);
    const status = await cli(root, ['cache', 'status']); assert.equal(JSON.parse(status.stdout).status, 'ready');
    const rebuilt = await cli(root, ['cache', 'rebuild']); assert.equal(rebuilt.status, 0, rebuilt.stderr);
    await stop(root);
    const persisted = await cli(root, ['test', 'list'], missing); assert.equal(JSON.parse(persisted.stdout).observations[0].observation.current, true);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
