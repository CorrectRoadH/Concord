// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查
import { checkSince } from './check-since.js';
import { checkCurrentProject } from './check-current.js';
import { Effect, Option } from 'effect';
import { Command } from 'effect/unstable/cli';
import { root, emit, cached, optional } from './cli-base.js';

const check = Command.make('check', { since: optional('since') }, args => Effect.gen(function*() { const settings = yield* root; const result = yield* (Option.isSome(args.since) ? checkSince(Option.getOrUndefined(settings.root), args.since.value, cached(settings.dryRun)) : checkCurrentProject(Option.getOrUndefined(settings.root), cached(settings.dryRun))); if (!result.ok) process.exitCode = 1; emit(result, settings.json); })).pipe(Command.withDescription('Validate current sources and optional endpoint changes, replaying newly recorded fixes.'));

export { check };
