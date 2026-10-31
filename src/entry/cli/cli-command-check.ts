// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查
import { checkSince } from "../../app/index.js";
import { checkCurrentProject } from "../../app/index.js";
import { Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { root, emit, cached, optional } from "./cli-base.js";
import { withQuery } from './cli-repository.js';

const check = Command.make('check', { since: optional('since') }, args => Effect.gen(function*() {
  if (Option.isNone(args.since)) { yield* withQuery({ name: 'check', input: {} }); return; }
  const settings = yield* root;
  const result = yield* checkSince(Option.getOrUndefined(settings.root), args.since.value, cached(settings.dryRun));
  if (!result.ok) process.exitCode = 1;
  emit(result, settings.json);
})).pipe(Command.withDescription('Validate current sources and optional endpoint changes, replaying newly recorded fixes.'));

export { check };
