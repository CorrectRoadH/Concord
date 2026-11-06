// @concord-file
// @concord-implements docs/feature/web-workbench/cli.md
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ConcordError } from "../../model/index.ts";
import { ViewLauncher } from "./launchers.ts";

import { exportChangePreview } from "../../app/index.ts";
import { root, optional, emit, sync, viewRoot } from "./cli-base.ts";

const view = Command.make('view', {
  host: Flag.string('host').pipe(Flag.withDefault('127.0.0.1')),
  port: Flag.integer('port').pipe(Flag.withDefault(4317)),
  inProcess: Flag.boolean('in-process').pipe(Flag.withDefault(false)),
}, args => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view does not accept --dry-run'));
  const launcher = yield* ViewLauncher;
  return yield* launcher.serve({ root: (yield* viewRoot(settings)), host: args.host, port: args.port, inProcess: args.inProcess }, (server) => emit({ operation: 'view', ...server }, settings.json));
})).pipe(Command.withDescription('Review local changes, or export a static committed comparison.'), Command.withSubcommands([
  Command.make('export', {
    base: Flag.string('base'), head: Flag.string('head').pipe(Flag.withDefault('HEAD')),
    baseLabel: Flag.string('base-label').pipe(Flag.optional), out: Flag.string('out'),
  }, args => Effect.gen(function*() {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view export does not accept --dry-run'));
    const result = yield* exportChangePreview({ root: (yield* viewRoot(settings)), base: args.base, head: args.head, baseLabel: Option.getOrUndefined(args.baseLabel), out: args.out });
    yield* emit(result, settings.json);
  })).pipe(Command.withDescription('Export a readonly static comparison from the unique merge-base to head; requires complete local Git history and a new output directory.')),
]));

export { view };
