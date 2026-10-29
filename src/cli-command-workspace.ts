// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { getWorkspaceSnapshot, validateViewRoot } from './application.js';
import { readWorkspaceProjection, workspaceProjectionContext } from './workspace-projection.js';
import { root, emit, sync, viewRoot } from './cli-base.js';

const workspace = Command.make('workspace').pipe(Command.withDescription('Inspect the shared human/agent workspace projection.'), Command.withSubcommands([
  Command.make('show', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* getWorkspaceSnapshot(viewRoot(settings), settings.dryRun ? 'off' : 'use'); yield* Effect.sync(() => emit(result, settings.json)); })),
  Command.make('projection', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* sync(() => readWorkspaceProjection(workspaceProjectionContext(validateViewRoot(viewRoot(settings))))); yield* Effect.sync(() => emit({ operation: 'workspace-projection', ...result }, settings.json)); })),
]));

export { workspace };
