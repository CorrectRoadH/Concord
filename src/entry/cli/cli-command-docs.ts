// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import { checkWriting } from "../../app/index.js";

import { Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { root, optional, sync } from "./cli-base.js";
import { withRepo } from "./cli-repository.js";

import { makeDocsWorkCommand } from "./repo-docs-work-command.js";

const docs = Command.make('docs').pipe(Command.withDescription('Check authored prose and terminology using consumer-owned writing policy.'), Command.withSubcommands([
  makeDocsWorkCommand(
    (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.sync(() => { process.stdout.write(delivery.stdout); process.stderr.write(delivery.stderr); if (delivery.exitCode !== 0) process.exitCode = delivery.exitCode; }),
    root.pipe(Effect.map(settings => ({ root: Option.getOrUndefined(settings.root), json: settings.json, dryRun: settings.dryRun }))),
  ),
  Command.make('check', { rules: optional('rules') }, args => withRepo((repo, settings) => sync(() => {
    const report = checkWriting(repo, Option.getOrUndefined(args.rules), !settings.dryRun);
    if (!report.ok) process.exitCode = 1;
    return report;
  }), { readonly: true })),
]));

export { docs };
