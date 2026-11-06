import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Fiber, Schema } from 'effect';
import { acquireTraceLeaseSync, releaseTraceLeaseSync } from '../../src/base/publication/index.ts';
import { digest, WorkspaceProjectionSchema } from '../../src/model/index.ts';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { command, record, rpcModule, stop } from '../support/workspace-server-fixture.ts';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-computation-'));
  execFileSync('git', ['init', '-q', root]);
  const result = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'init', '--docs-only', '--source-root', 'src'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/0.ts'), 'export const value = 0;\n');
  return root;
};
const environment = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined));
const workerPid = (root: string) => pollUntil(async () => {
  for (const line of execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n')) {
    const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (row && Number(row[2]) === record(root).pid && row[3]!.includes('compute-worker.js') && row[3]!.includes(root)) return Number(row[1]);
  }
  return undefined;
}, { description: 'installed service owns a real computation process', timeoutMs: 10_000 });
const projection = (rpc: Awaited<ReturnType<typeof rpcModule>>, connection: Effect.Success<ReturnType<typeof rpc.connectWorkspaceSocket>>) =>
  pollUntil(async () => {
    try { return Schema.decodeUnknownSync(WorkspaceProjectionSchema, { onExcessProperty: 'error' })(await Effect.runPromise(rpc.requestWorkspace(connection, 'workspace', {}))); }
    catch { return undefined; }
  }, { description: 'installed service accepted a computation generation', timeoutMs: 10_000 });

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name scan-child-termination-releases-exact-token
test('cancelling a queued computation preserves the active child and cancelling its owner confirms group cleanup', { timeout: 30_000 }, async () => {
  const root = fixture();
  const lease = acquireTraceLeaseSync(root, 'shared', 'unrelated-computation-reader')!;
  let pid: number | undefined;
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const running = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      yield* Effect.promise(() => projection(rpc, connection));
      pid = yield* Effect.promise(() => workerPid(root));
      process.kill(pid, 'SIGSTOP');
      const active = yield* Effect.forkScoped(rpc.requestWorkspace(connection, 'query', { name: 'code.list', input: {}, environment, cache: 'use' }));
      yield* connection.client.hello({ protocol: 'concord.workspace/v1', installation: running.installation });
      const queued = yield* Effect.forkScoped(rpc.requestWorkspace(connection, 'query', { name: 'code.list', input: {}, environment, cache: 'use' }));
      yield* connection.client.hello({ protocol: 'concord.workspace/v1', installation: running.installation });
      yield* Fiber.interrupt(queued);
      assert.doesNotThrow(() => process.kill(pid!, 0));
      yield* Fiber.interrupt(active);
      yield* Effect.promise(() => pollUntil(async () => {
        try { process.kill(pid!, 0); return undefined; } catch { return true; }
      }, { description: 'RPC cancellation confirms computation process group termination' }));
      assert.deepEqual(readdirSync(lease.path), [`${lease.owner.token}.json`]);
      const next = yield* rpc.requestWorkspace(connection, 'query', { name: 'code.list', input: {}, environment, cache: 'use' });
      assert.equal(Schema.decodeUnknownSync(Schema.Struct({ exitCode: Schema.Int }))(next).exitCode, 0);
      assert.deepEqual(readdirSync(lease.path), [`${lease.owner.token}.json`]);
    })));
  } finally {
    if (pid !== undefined) try { process.kill(pid, 'SIGCONT'); } catch { /* confirmed reaped */ }
    await stop(root);
    releaseTraceLeaseSync(lease, 'unrelated-computation-reader');
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name scan-generations-do-not-reuse-completed-results
test('later computation generations reuse the idle process but never reuse a completed source result', { timeout: 30_000 }, async () => {
  const root = fixture();
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const running = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      const first = yield* Effect.promise(() => projection(rpc, connection));
      const pid = yield* Effect.promise(() => workerPid(root));
      const changed = 'export const changed = true;\n';
      writeFileSync(join(root, 'src/0.ts'), changed);
      const next = yield* Effect.promise(() => pollUntil(async () => {
        const value = await projection(rpc, connection);
        return value.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest === digest(changed) ? value : undefined;
      }, { description: 'watch refresh accepts the changed source as a new generation', timeoutMs: 10_000 }));
      assert.equal(yield* Effect.promise(() => workerPid(root)), pid);
      assert.notEqual(first.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest, next.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest);
      assert.equal(next.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest, digest(changed));
    })));
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
