// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import { checkWriting } from './writing.js';
import { NodeServices } from '@effect/platform-node';
import { Effect, Option } from 'effect';
import { Command } from 'effect/unstable/cli';
import { root, optional, sync } from './cli-base.js';
import { withRepo } from './cli-repository.js';

const docsWorkContributionPath = new URL(import.meta.url).pathname.endsWith('.ts') ? '../repository/docs/work/index.ts' : './repository/docs/work/index.js';

const docs = Command.make('docs').pipe(Command.withDescription('Check authored prose and terminology using consumer-owned writing policy.'), Command.withSubcommands([
  (await import(docsWorkContributionPath) as { makeDocsWorkCommand: <R>(deliver: (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.Effect<void>, settings: Effect.Effect<{ root: string | undefined; json: boolean; dryRun: boolean }, never, R>) => Command.Command<any, never, unknown, never, NodeServices.NodeServices | R> }).makeDocsWorkCommand(
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
