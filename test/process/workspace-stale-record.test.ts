// 跨进程保证：OS 锁与互斥——服务死亡后的失效运行记录不阻止重启，持有者仍占锁时不覆盖记录。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { acquireServerLock, scopedServerLock, ServerRecord } from '../../src/base/server-lock/index.ts';
import { pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(ServerRecord), { onExcessProperty: 'error' });
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(ServerRecord));

async function leaveStaleRecord(root: string) {
  const started = await command(root, ['server', 'start']);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const before = decodeRecord(readFileSync(recordPath(root), 'utf8'));
  process.kill(before.pid, 'SIGKILL');
  await pollUntil(async () => {
    const lock = await Effect.runPromise(Effect.result(Effect.scoped(scopedServerLock(dirname(recordPath(root))).pipe(Effect.provideService(RuntimeEnvironment, runtime)))));
    return lock._tag === 'Success' ? true : undefined;
  }, { description: 'the killed service releases the real native lock', timeoutMs: 5000 });
  rmSync(before.socket.path, { force: true });
  writeFileSync(recordPath(root), encodeRecord({ ...before, lock: { ...before.lock, device: String(BigInt(before.lock.device) + 1n) } }));
  return before;
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('workspace reads restart after reboot leaves a record with a different device', { timeout: 30_000 }, async () => {
  const root = await fixture();
  try {
    const before = await leaveStaleRecord(root);
    const read = await command(root, ['workspace', 'show']);
    assert.equal(read.status, 0, read.stdout + read.stderr);
    assert.notEqual(record(root).token, before.token);
    assert.equal(existsSync(record(root).socket.path), true);
  } finally {
    if (existsSync(recordPath(root)) && existsSync(record(root).socket.path)) await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('server stop confirms stale ownership and command queries replace malformed records', { timeout: 30_000 }, async () => {
  const root = await fixture();
  try {
    await leaveStaleRecord(root);
    const stopped = await command(root, ['server', 'stop']);
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    writeFileSync(recordPath(root), '{');
    const read = await command(root, ['--server=command', 'list', 'feature']);
    assert.equal(read.status, 0, read.stdout + read.stderr);
    assert.equal(existsSync(recordPath(root)), false, 'command ownership ends before returning');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('an invalid record stays rejected while the actual service lock is held', { timeout: 30_000 }, async () => {
  const root = await fixture();
  try {
    await leaveStaleRecord(root);
    const before = readFileSync(recordPath(root), 'utf8');
    const lock = await Effect.runPromise(acquireServerLock(join(root, '.git/concord/server')).pipe(Effect.provideService(RuntimeEnvironment, runtime)));
    try {
      const read = await command(root, ['workspace', 'show']);
      assert.equal(read.status, 1, read.stdout + read.stderr);
      const failure = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(false), error: Schema.Literal('WorkspaceServerUnavailable'), message: Schema.String }), { onExcessProperty: 'error' })(JSON.parse(read.stdout || read.stderr));
      assert.equal(failure.error, 'WorkspaceServerUnavailable');
      assert.equal(readFileSync(recordPath(root), 'utf8'), before);
      await Effect.runPromise(lock.verify);
    } finally { await Effect.runPromise(lock.close); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
