// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查
import { checkCurrentProject } from './check-current.js';
import { Effect, Option } from 'effect';
import { Command } from 'effect/unstable/cli';
import { root, emit, cached } from './cli-base.js';

const check = Command.make('check', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* checkCurrentProject(Option.getOrUndefined(settings.root), cached(settings.dryRun)); if (!result.ok) process.exitCode = 1; emit(result, settings.json); })).pipe(Command.withDescription('Validate source ownership, references and writing policy; do not execute tests.'));

export { check };
