import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { SourceWebBuilder, SourceWebBuilderLive } from '../../base/installation/index.ts';

// NodeRuntime owns signal interruption and scope teardown. Parent death travels
// over the private IPC channel, including when the service itself was SIGKILLed.
const stop = () => process.kill(process.pid, 'SIGTERM');
process.once('disconnect', stop);
if (process.send !== undefined && !process.connected) queueMicrotask(stop);

NodeRuntime.runMain(Effect.gen(function*() {
  const builder = yield* SourceWebBuilder;
  yield* builder.run;
}).pipe(Effect.scoped, Effect.provide(SourceWebBuilderLive.pipe(Layer.provide(NodeServices.layer))), Effect.ensuring(Effect.sync(() => {
  process.off('disconnect', stop);
  if (process.connected) process.disconnect();
}))));
