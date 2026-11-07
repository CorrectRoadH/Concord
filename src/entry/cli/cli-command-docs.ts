// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import { checkWriting } from "../../app/index.ts";

import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { root, optional, sync } from "./cli-base.ts";
import { withRepo, withQuery } from "./cli-repository.ts";

import { makeDocsWorkCommand } from "./repo-docs-work-command.ts";
import { setExitCode, writeStderr, writeStdout } from './invocation.ts';

const docs = Command.make('docs').pipe(Command.withDescription('Check authored prose and terminology using consumer-owned writing policy.'), Command.withSubcommands([
  makeDocsWorkCommand(
    (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.gen(function*() {
      yield* writeStdout(delivery.stdout);
      yield* writeStderr(delivery.stderr);
      if (delivery.exitCode !== 0) yield* setExitCode(delivery.exitCode);
    }),
    root.pipe(Effect.map(settings => ({ root: Option.getOrUndefined(settings.root), json: settings.json, dryRun: settings.dryRun }))),
  ),
  Command.make('check', {}, () => withQuery({ name: 'docs.check', input: {} })),
]));

export { docs };
