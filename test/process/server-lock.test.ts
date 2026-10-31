// @concord-file
// @concord-verifies docs/feature/local-data-engine/architecture.md#启动与裁决
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { acquireServerLock, scopedServerLock } from '../../src/base/server-lock/index.js';
import { tmpdir } from '../support/temporary.js';

if (process.env.CONCORD_SERVER_LOCK_CHILD) {
  const handle = await Effect.runPromise(acquireServerLock(process.env.CONCORD_SERVER_LOCK_CHILD));
  process.stdout.write('READY\n');
  process.on('SIGTERM', () => { Effect.runSync(handle.close); process.exit(0); });
  setInterval(() => {}, 1000);
} else {
  function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-server-lock-'))), server = join(root, 'server');
    mkdirSync(server);
    return { root, server, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }
  async function owner(server: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
      env: { ...process.env, CONCORD_SERVER_LOCK_CHILD: server }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '', errors = '';
        const timeout = setTimeout(() => reject(new Error(`lock owner not ready: ${errors}`)), 15000);
        child.once('exit', status => { clearTimeout(timeout); reject(new Error(`lock owner exited ${status}: ${errors}`)); });
        child.stderr!.on('data', chunk => { errors += String(chunk); });
        child.stdout!.on('data', chunk => { output += String(chunk); if (output.includes('READY\n')) { clearTimeout(timeout); resolve(); } });
      });
      return child;
    } catch (cause) { child.kill('SIGKILL'); await once(child, 'exit'); throw cause; }
  }
  async function stop(child: ChildProcess, signal: NodeJS.Signals) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill(signal); await exited;
  }
  test('two real processes contend; OS releases service lock after owner death', () => Effect.runPromise(Effect.tryPromise(async () => {
    const f = fixture(); let child: ChildProcess | undefined;
    try {
      child = await owner(f.server);
      assert.equal((await Effect.runPromise(acquireServerLock(f.server).pipe(Effect.flip)))._tag, 'ServerLockHeld');
      await stop(child, 'SIGKILL');
      const acquired = await Effect.runPromise(acquireServerLock(f.server));
      await Effect.runPromise(acquired.verify);
      assert.match(acquired.identity.inode, /^\d+$/u);
      await Effect.runPromise(acquired.close);
      await Effect.runPromise(acquired.close);
      assert.equal((await Effect.runPromise(acquired.verify.pipe(Effect.flip))).reason, 'closed');
    } finally { if (child) await stop(child, 'SIGKILL'); f.cleanup(); }
  })));
  test('deleting and rebuilding server directory invalidates held device/inode', () => Effect.runPromise(Effect.tryPromise(async () => {
    const f = fixture();
    try {
      const held = await Effect.runPromise(acquireServerLock(f.server));
      try {
        rmSync(f.server, { recursive: true }); mkdirSync(f.server); writeFileSync(join(f.server, 'lock'), 'new inode');
        assert.equal((await Effect.runPromise(held.verify.pipe(Effect.flip))).reason, 'identity');
      } finally { await Effect.runPromise(held.close); }
    } finally { f.cleanup(); }
  })));
  test('lock replacement, symlinks and multiple links never masquerade as contention', () => Effect.runPromise(Effect.tryPromise(async () => {
    const f = fixture(); const path = join(f.server, 'lock');
    try {
      const held = await Effect.runPromise(acquireServerLock(f.server));
      try {
        rmSync(path); writeFileSync(path, 'replacement');
        assert.equal((await Effect.runPromise(held.verify.pipe(Effect.flip))).reason, 'identity');
      } finally { await Effect.runPromise(held.close); }
      rmSync(path); symlinkSync('elsewhere', path);
      let error = await Effect.runPromise(acquireServerLock(f.server).pipe(Effect.flip));
      assert.equal(error._tag, 'ServerLockUnavailable'); if (error._tag === 'ServerLockUnavailable') assert.equal(error.reason, 'type');
      rmSync(path); writeFileSync(path, ''); linkSync(path, join(f.server, 'alias'));
      error = await Effect.runPromise(acquireServerLock(f.server).pipe(Effect.flip));
      assert.equal(error._tag, 'ServerLockUnavailable'); if (error._tag === 'ServerLockUnavailable') assert.equal(error.reason, 'type');
    } finally { f.cleanup(); }
  })));
  test('permission and I/O errors are distinct; scoped ownership releases on failure', () => Effect.runPromise(Effect.tryPromise(async () => {
    const f = fixture();
    try {
      const missing = await Effect.runPromise(acquireServerLock(join(f.server, 'missing')).pipe(Effect.flip));
      assert.equal(missing._tag, 'ServerLockUnavailable'); if (missing._tag === 'ServerLockUnavailable') assert.equal(missing.reason, 'io');
      if (process.getuid?.() !== 0) {
        chmodSync(f.server, 0);
        try {
          const denied = await Effect.runPromise(acquireServerLock(f.server).pipe(Effect.flip));
          assert.equal(denied._tag, 'ServerLockUnavailable'); if (denied._tag === 'ServerLockUnavailable') assert.equal(denied.reason, 'permission');
        } finally { chmodSync(f.server, 0o700); }
      }
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() { yield* scopedServerLock(f.server); return yield* Effect.fail('failure'); })).pipe(Effect.flip));
      await Effect.runPromise(Effect.scoped(scopedServerLock(f.server)));
    } finally { f.cleanup(); }
  })));
}
