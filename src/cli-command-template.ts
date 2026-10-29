// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#随包模板
import { Effect, Option } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';
import { listTemplates, templateBody } from './templates.js';
import { root, optional, body, emit, sync } from './cli-base.js';

const templates = Command.make('template').pipe(Command.withDescription('Inspect built-in writing templates without a project.'), Command.withSubcommands([
  Command.make('list', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* sync(() => ({ operation: 'template-list', templates: listTemplates() })); yield* Effect.sync(() => emit(result, settings.json)); })),
  Command.make('show', { name: Argument.string('name'), title: optional('title') }, args => Effect.gen(function*() { const settings = yield* root; const result = yield* sync(() => ({ operation: 'template-show', name: args.name, body: templateBody(args.name, Option.getOrElse(args.title, () => 'Your title')) })); yield* Effect.sync(() => emit(result, settings.json)); })),
]));

export { templates };
