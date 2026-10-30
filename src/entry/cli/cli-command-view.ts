// @concord-file
// @concord-implements docs/feature/web-workbench/cli.md
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ConcordError } from "../../model/index.js";
import { serveViewServer } from "../http/index.js";
import { viewAddresses } from "../http/index.js";
import { exportChangePreview } from "../../app/index.js";
import { root, optional, emit, sync, viewRoot } from "./cli-base.js";

const view = Command.make('view', {
  host: Flag.string('host').pipe(Flag.withDefault('127.0.0.1')),
  port: Flag.integer('port').pipe(Flag.withDefault(4317)),
}, args => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view does not accept --dry-run'));
  return yield* serveViewServer({ root: viewRoot(settings), host: args.host, port: args.port }, (server) => emit({ operation: 'view', root: server.root, host: server.host, port: server.port, address: server.address, ...viewAddresses(server.host, server.port) }, settings.json));
})).pipe(Command.withDescription('Review local changes, or export a static committed comparison.'), Command.withSubcommands([
  Command.make('export', {
    base: Flag.string('base'), head: Flag.string('head').pipe(Flag.withDefault('HEAD')),
    baseLabel: Flag.string('base-label').pipe(Flag.optional), out: Flag.string('out'),
  }, args => Effect.gen(function*() {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view export does not accept --dry-run'));
    const result = yield* exportChangePreview({ root: viewRoot(settings), base: args.base, head: args.head, baseLabel: Option.getOrUndefined(args.baseLabel), out: args.out });
    yield* Effect.sync(() => emit(result, settings.json));
  })).pipe(Command.withDescription('Export a readonly static comparison from the unique merge-base to head; requires complete local Git history and a new output directory.')),
]));

export { view };
