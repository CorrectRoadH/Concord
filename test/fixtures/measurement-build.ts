import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { join } from 'node:path';
import { buildForMeasurement } from '../../scripts/measurement-build.js';

Effect.gen(function*() {
  const root = yield* Schema.decodeUnknownEffect(Schema.String)(process.argv[2]);
  const port = yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(process.argv[3]);
  yield* buildForMeasurement(root, join(root, 'runs'), port);
  yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ sampling: true, pid: process.pid })}\n`));
  yield* Effect.tryPromise(() => new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('end', resolve); }));
}).pipe(Effect.scoped, NodeRuntime.runMain);
