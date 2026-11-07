// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
import { Effect, Option } from 'effect';
import { Command } from 'effect/cli';
import { installWorkflowSkills, openWriteRepository } from '../../app/index.ts';
import { emit, root } from './cli-base.ts';

export const skills = Command.make('skills').pipe(
  Command.withDescription('Install or update managed Concord workflow skills for Codex and Claude Code.'),
  Command.withSubcommands([
    Command.make('install', {}, () => Effect.scoped(Effect.gen(function*() {
      const settings = yield* root;
      // Preview requires publication validation, but opens no writable state.
      const repo = yield* Effect.acquireRelease(openWriteRepository(Option.getOrUndefined(settings.root), {
        access: 'read', dryRun: true, optimistic: true, persistentCache: 'off',
      }), opened => Effect.sync(() => opened.close()));
      const preview = yield* installWorkflowSkills(repo, true);
      if (settings.dryRun) {
        yield* emit(preview, settings.json);
        return;
      }
      yield* Effect.sync(() => repo.close());
      const writer = yield* Effect.acquireRelease(openWriteRepository(repo.root, { optimistic: true, persistentCache: 'off' }), opened => Effect.sync(() => opened.close()));
      const result = yield* installWorkflowSkills(writer, false);
      yield* emit(result, settings.json);
    }))),
  ]),
);
