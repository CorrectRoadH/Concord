import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { acquireBuildLock } from '../../scripts/build-lock.js';

test('build and gate contenders wait for the same owner and recover after its death', { timeout: 20_000 }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(cause => cause ? reject(cause) : resolve()));
  const launch = (token?: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('test/fixtures/build-lock.ts'), String(port)], { env: { ...process.env, CONCORD_BUILD_LOCK: token ?? '' }, stdio: 'pipe' });
    const closed = once(child, 'close');
    let output = '', diagnostics = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); });
    const line = async (stream: typeof child.stdout, read: () => string, pattern: RegExp) => {
      while (!pattern.test(read())) {
        await Promise.race([once(stream, 'data'), closed.then(() => { throw new Error(`Lock fixture exited: ${output}\n${diagnostics}`); })]);
      }
      return read();
    };
    return { child, closed, acquired: () => line(child.stdout, () => output, /"acquired":true/u), waiting: () => line(child.stderr, () => diagnostics, /Build lock: waiting/u), output: () => output };
  };
  const owner = launch(); const children = [owner];
  try {
    const metadata = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ acquired: Schema.Boolean, token: Schema.String })))(await owner.acquired());
    const nested = launch(metadata.token); children.push(nested); await nested.acquired();
    nested.child.stdin.end(); assert.equal((await nested.closed)[0], 0);
    const waiter = launch(); children.push(waiter);
    const waiting = await waiter.waiting();
    assert.match(waiting, new RegExp(`pid=${owner.child.pid}; started=\\d{4}-`));
    assert.equal(waiter.output(), '');
    owner.child.kill('SIGKILL'); await owner.closed;
    await waiter.acquired();
    waiter.child.stdin.end(); assert.equal((await waiter.closed)[0], 0);
    const lock = await Effect.runPromise(acquireBuildLock(undefined, port)); await lock.release();
  } finally {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(children.map(child => child.closed));
  }
})));
