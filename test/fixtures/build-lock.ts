import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { acquireBuildLock } from '../../scripts/build-lock.js';

Effect.gen(function*() {
  const port = yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(process.argv[2]);
  const lock = yield* Effect.acquireRelease(acquireBuildLock(process.env.CONCORD_BUILD_LOCK, port), lock => Effect.promise(lock.release));
  yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ acquired: true, token: lock.token })}\n`));
  yield* Effect.tryPromise(() => new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('end', resolve); }));
}).pipe(Effect.scoped, NodeRuntime.runMain);
