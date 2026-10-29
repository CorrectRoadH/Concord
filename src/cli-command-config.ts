// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
import { Command } from 'effect/unstable/cli';
import { setConfig, showConfig } from './editing.js';
import { ProjectSchema, decode } from './shared.js';
import { text, body, sync, expected } from './cli-base.js';
import { withRepo, withReadRepo } from './cli-repository.js';

const config = Command.make('config').pipe(Command.withDescription('Inspect or replace the normalized project configuration with whole-file CAS.'), Command.withSubcommands([
  Command.make('show', {}, () => withReadRepo(repo => sync(() => ({ ...showConfig(repo), path: repo.configSnapshot.path, source: repo.configSnapshot.source })))),
  Command.make('set', { input: text('input'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => setConfig(repo, decode(ProjectSchema, JSON.parse(body(args.input)), 'configuration input'), args.expectedDigest, settings.dryRun)))),
]));

export { config };
