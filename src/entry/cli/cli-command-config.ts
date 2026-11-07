// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
import { Command } from "effect/cli";
import { Effect } from 'effect';
import { setConfig, showConfig } from "../../app/index.ts";
import { ProjectSchema, decode } from "../../model/index.ts";
import { text, body, sync } from "./cli-base.ts";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.ts";

const config = Command.make('config').pipe(Command.withDescription('Inspect or replace the normalized project configuration with whole-file CAS.'), Command.withSubcommands([
  Command.make('show', {}, () => withQuery({ name: 'config.show', input: {} })),
  Command.make('set', { input: text('input'), expectedDigest: text('if-unchanged') }, args => withRepo((repo, settings) => Effect.gen(function*() {
    const source = yield* body(args.input);
    return yield* sync(async () => (await setConfig(repo, decode(ProjectSchema, JSON.parse(source), 'configuration input'), args.expectedDigest, settings.dryRun)));
  }))),
]));

export { config };
