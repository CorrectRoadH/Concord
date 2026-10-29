// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md
import { Command } from 'effect/unstable/cli';
import { adoptConstitution, amendConstitution, constitutionShow, initializeConstitution } from './constitution.js';
import { migrateConstitution } from './constitution-migrate.js';
import { text, many, body, sync, expected } from './cli-base.js';
import { withRepo, withReadRepo } from './cli-repository.js';

const constitution = Command.make('constitution').pipe(Command.withDescription('Inspect, initialize, adopt, and amend the single project constitution with CAS.'), Command.withSubcommands([
  Command.make('show', {}, () => withReadRepo(repo => sync(() => constitutionShow(repo)))).pipe(Command.withDescription('Show clauses, paragraphs and every in-scope link that references them; complete is false when references cannot be read or decoded.')),
  Command.make('initialize', {}, () => withRepo((repo, settings) => sync(() => initializeConstitution(repo, settings.dryRun)))),
  Command.make('adopt', { body: text('body'), reason: text('reason'), impact: text('impact'), source: many('source'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => adoptConstitution(repo, body(args.body), args.reason, args.impact, args.source, args.expectedDigest, settings.dryRun)))),
  Command.make('amend', { body: text('body'), reason: text('reason'), impact: text('impact'), source: many('source'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => amendConstitution(repo, body(args.body), args.reason, args.impact, args.source, args.expectedDigest, settings.dryRun)))),
  Command.make('migrate', {}, () => withRepo((repo, settings) => sync(() => migrateConstitution(repo, settings.dryRun)))).pipe(Command.withDescription('Convert a v1 constitution and Feature/Design constitutionRefs metadata into heading IDs and body links in one recoverable publication.')),
]));

export { constitution };
