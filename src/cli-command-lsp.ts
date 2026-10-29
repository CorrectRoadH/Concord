// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md
import { serveEditor } from './lsp-server.js';
import { Effect, Option } from 'effect';
import { Command } from 'effect/unstable/cli';
import { root } from './cli-base.js';

const lsp = Command.make('lsp', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  yield* serveEditor(Option.getOrUndefined(settings.root));
})).pipe(Command.withDescription('Serve read-only Concord editor navigation and diagnostics over framed stdio.'));

export { lsp };
