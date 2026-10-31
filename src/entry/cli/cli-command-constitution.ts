// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md
import { Command } from "effect/unstable/cli";
import { adoptConstitution, amendConstitution, constitutionShow } from "../../app/index.js";
import { text, many, body, sync } from "./cli-base.js";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.js";

const constitution = Command.make('constitution').pipe(Command.withDescription('Inspect, adopt, and amend the single project constitution with CAS.'), Command.withSubcommands([
  Command.make('show', {}, () => withQuery({ name: 'constitution.show', input: {} })).pipe(Command.withDescription('Show clauses, paragraphs and every in-scope link that references them; complete is false when references cannot be read or decoded.')),
  Command.make('adopt', { body: text('body'), reason: text('reason'), impact: text('impact'), source: many('source'), expectedDigest: text('if-unchanged') }, args => withRepo((repo, settings) => sync(() => adoptConstitution(repo, body(args.body), args.reason, args.impact, args.source, args.expectedDigest, settings.dryRun)))),
  Command.make('amend', { body: text('body'), reason: text('reason'), impact: text('impact'), source: many('source'), expectedDigest: text('if-unchanged') }, args => withRepo((repo, settings) => sync(() => amendConstitution(repo, body(args.body), args.reason, args.impact, args.source, args.expectedDigest, settings.dryRun)))),
]));

export { constitution };
