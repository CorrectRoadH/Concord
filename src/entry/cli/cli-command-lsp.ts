// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md
import { setExitCode } from './invocation.ts';
import { LspLauncher } from "./launchers.ts";
import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { root } from "./cli-base.ts";

const lsp = Command.make('lsp', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  yield* setExitCode(yield* (yield* LspLauncher).serve(Option.getOrUndefined(settings.root)));
})).pipe(Command.withDescription('Serve read-only Concord editor navigation and diagnostics over framed stdio.'));

export { lsp };
