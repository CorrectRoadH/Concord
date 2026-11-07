// @concord-file
// @concord-implements docs/feature/web-workbench/cli.md
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ConcordError } from "../../model/index.ts";
import { resolve } from 'node:path';
import { ViewLauncher } from "./launchers.ts";

import { exportChangePreview, verifyChangePreview, applicationRuntime } from "../../app/index.ts";
import { root, optional, emit, sync, viewRoot } from "./cli-base.ts";

const view = Command.make('view', {
  host: Flag.String('host').pipe(Flag.withDefault('127.0.0.1')),
  port: Flag.Int('port').pipe(Flag.withDefault(4317)),
  inProcess: Flag.Boolean('in-process').pipe(Flag.withDefault(false)),
}, args => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view does not accept --dry-run'));
  const launcher = yield* ViewLauncher;
  return yield* launcher.serve({ root: (yield* viewRoot(settings)), host: args.host, port: args.port, inProcess: args.inProcess }, (server) => emit({ operation: 'view', ...server }, settings.json));
})).pipe(Command.withDescription('Review local changes, or export a static committed comparison.'), Command.withSubcommands([
  Command.make('verify', { directory: Argument.String('directory') }, args => Effect.gen(function*() {
    const settings = yield* root;
    const runtime = yield* applicationRuntime;
    yield* emit(yield* verifyChangePreview(resolve(runtime.cwd, args.directory)), settings.json);
  })).pipe(Command.withDescription('Strictly validate an exported preview directory without opening a project.')),
  Command.make('export', {
    base: Flag.String('base'), head: Flag.String('head').pipe(Flag.withDefault('HEAD')),
    baseLabel: Flag.String('base-label').pipe(Flag.optional), out: Flag.String('out'),
  }, args => Effect.gen(function*() {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view export does not accept --dry-run'));
    const result = yield* exportChangePreview({ root: (yield* viewRoot(settings)), base: args.base, head: args.head, baseLabel: Option.getOrUndefined(args.baseLabel), out: args.out });
    yield* emit(result, settings.json);
  })).pipe(Command.withDescription('Export a readonly static comparison from the unique merge-base to head; requires complete local Git history and a new output directory.')),
]));

export { view };
