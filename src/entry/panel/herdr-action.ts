// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#herdr-插件
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { openHerdrPanel, PanelWorktreeUnknown } from './herdr.js';

const action = Effect.gen(function*() {
  const context = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? '').pipe(
    Effect.mapError(() => new PanelWorktreeUnknown({ message: 'PanelWorktreeUnknown：Herdr 没有提供有效的当前 pane 上下文。' })),
  );
  yield* openHerdrPanel(context, process.env.HERDR_SOCKET_PATH ?? '');
});
NodeRuntime.runMain(action);
