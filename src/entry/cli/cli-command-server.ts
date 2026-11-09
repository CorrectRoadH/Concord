// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import { ConcordError } from '../../model/index.ts';
import { ServerLauncher } from './launchers.ts';
import { root, viewRoot, emit } from './cli-base.ts';

const operation = (name: 'start' | 'stop' | 'run') => Command.make(name, {}, () => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'server does not accept --dry-run'));
  const launcher = yield* ServerLauncher;
  const value = yield* launcher[name]((yield* viewRoot(settings)));
  if (name !== 'run') yield* emit(value, settings.json);
}));
const status = Command.make('status', { wait: Flag.Boolean('wait').pipe(Flag.withDefault(false), Flag.withDescription('Observe an externally started service for up to ten seconds without starting one.')) }, args => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'server does not accept --dry-run'));
  const value = yield* (yield* ServerLauncher).status(yield* viewRoot(settings), args.wait);
  yield* emit(value, settings.json);
}));
export const server = Command.make('server').pipe(Command.withDescription('Manage the local worktree service.'), Command.withSubcommands([operation('start'), operation('stop'), status, operation('run')]));
