import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { installationUseMarker } from '../../src/base/installation/index.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('installation use markers follow normal, failed and cancelled scopes, and source installs never write them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-install-marker-'));
  const app = join(root, 'app'), marker = join(root, '.in-use', String(process.pid));
  mkdirSync(app); mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/concord'), '');
  try {
    await Effect.runPromise(Effect.scoped(installationUseMarker(app, true)));
    assert.equal(existsSync(join(root, '.in-use')), false);
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      yield* installationUseMarker(app, false); assert.equal(existsSync(marker), true);
    })));
    assert.equal(existsSync(marker), false);
    // A previous process may have left this filename before the PID was reused.
    writeFileSync(marker, '');
    await Effect.runPromise(Effect.scoped(installationUseMarker(app, false)));
    assert.equal(existsSync(marker), false);
    const failed = await Effect.runPromise(Effect.scoped(installationUseMarker(app, false).pipe(Effect.andThen(Effect.fail('startup failed')))).pipe(Effect.result));
    assert.equal(failed._tag, 'Failure'); assert.equal(existsSync(marker), false);
    await Effect.runPromise(Effect.gen(function*() {
      const ready = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(Effect.scoped(Effect.gen(function*() {
        yield* installationUseMarker(app, false); yield* Deferred.succeed(ready, undefined); yield* Effect.never;
      })));
      yield* Deferred.await(ready); assert.equal(existsSync(marker), true);
      yield* Fiber.interrupt(fiber); assert.equal(existsSync(marker), false);
    }));
    // A path replaced during shutdown belongs to somebody else.
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      yield* installationUseMarker(app, false);
      renameSync(marker, `${marker}.old`); writeFileSync(marker, 'replacement');
    })));
    assert.equal(existsSync(marker), true);
  } finally { chmodSync(root, 0o755); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('read-only installation roots do not acquire a marker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-readonly-marker-'));
  mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'bin/concord'), '');
  chmodSync(root, 0o555);
  try {
    await Effect.runPromise(Effect.scoped(installationUseMarker(join(root, 'app'), false)));
    assert.equal(existsSync(join(root, '.in-use')), false);
    chmodSync(root, 0o755); mkdirSync(join(root, '.in-use')); chmodSync(root, 0o555);
    await Effect.runPromise(Effect.scoped(installationUseMarker(join(root, 'app'), false)));
    assert.equal(existsSync(join(root, '.in-use', String(process.pid))), false);
  } finally { chmodSync(root, 0o755); rmSync(root, { recursive: true, force: true }); }
});
