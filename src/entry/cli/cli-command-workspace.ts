// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { getWorkspaceSnapshot, validateViewRoot } from "../../app/index.js";
import { readWorkspaceProjection, workspaceProjectionContext } from "../../app/index.js";
import { root, emit, sync, viewRoot } from "./cli-base.js";
import { ServerLauncher } from './launchers.js';
import { withQuery } from './cli-repository.js';

const workspace = Command.make('workspace').pipe(Command.withDescription('Inspect the shared human/agent workspace projection.'), Command.withSubcommands([
  Command.make('show', {}, () => withQuery({ name: 'workspace.show', input: {} })),
  Command.make('projection', {}, () => Effect.gen(function*() { const settings = yield* root; const path = validateViewRoot(viewRoot(settings)); const remote = settings.dryRun ? undefined : yield* (yield* ServerLauncher).projection(path); const result = remote ?? (yield* readWorkspaceProjection(yield* workspaceProjectionContext(path))); yield* Effect.sync(() => emit({ operation: 'workspace-projection', ...result }, settings.json)); })),
]));

export { workspace };
