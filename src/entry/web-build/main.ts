import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../base/environment/index.ts';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ConfigProvider, Effect, Layer, Schema } from 'effect';
import { SourceWebBuilder, SourceWebBuilderLive } from '../../base/installation/index.ts';

// NodeRuntime owns signal interruption and scope teardown. Parent death travels
// over the private IPC channel, including when the service itself was SIGKILLed.
const stop = () => process.kill(process.pid, 'SIGTERM');
process.once('disconnect', stop);
if (process.send !== undefined && !process.connected) queueMicrotask(stop);

NodeRuntime.runMain(Effect.gen(function*() {
  const [, cwd] = yield* Schema.decodeUnknownEffect(SourceWebBuilder.Arguments)(process.argv.slice(2));
  const runtime = makeRuntimeEnvironment(cwd, process.env);
  yield* Effect.gen(function*() {
    const builder = yield* SourceWebBuilder;
    yield* builder.run;
  }).pipe(Effect.provide(SourceWebBuilderLive.pipe(Layer.provide(NodeServices.layer))), Effect.provide(RuntimeEnvironment.layer(runtime)), Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(runtime.env))));
}).pipe(Effect.scoped, Effect.ensuring(Effect.sync(() => {
  process.off('disconnect', stop);
  if (process.connected) process.disconnect?.();
}))));
