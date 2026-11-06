// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { ConcordError } from '../../model/index.ts';
import { ServerLauncher } from './launchers.ts';
import { root, viewRoot, emit } from './cli-base.ts';

const operation = (name: 'start' | 'stop' | 'status' | 'run') => Command.make(name, {}, () => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'server does not accept --dry-run'));
  const launcher = yield* ServerLauncher;
  const value = yield* launcher[name]((yield* viewRoot(settings)));
  if (name !== 'run') yield* emit(value, settings.json);
}));
export const server = Command.make('server').pipe(Command.withDescription('Manage the local worktree service.'), Command.withSubcommands(['start', 'stop', 'status', 'run'].map(name => operation(name as 'start' | 'stop' | 'status' | 'run'))));
