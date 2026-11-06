// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#结果
// @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
import { Command } from "effect/unstable/cli";
import { doctor, projectInitializationRequired, uninitializedDoctor } from "../../app/index.ts";
import { Effect, Option } from 'effect';
import { root, emit, sync } from "./cli-base.ts";
import { withReadRepo } from "./cli-repository.ts";
import { setExitCode } from './invocation.ts';
import { applicationRuntime } from '../../app/index.ts';

const diagnose = Command.make('doctor', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  const runtime = yield* applicationRuntime;
  const required = yield* sync(() => projectInitializationRequired(Option.getOrUndefined(settings.root), false, runtime));
  if (required) {
    const result = yield* sync(() => uninitializedDoctor(required, process.version));
    yield* emit(result, settings.json);
    return result;
  }
  return yield* withReadRepo(repo => Effect.gen(function*() {
    const result = yield* sync(() => doctor(repo, undefined, 'off', runtime.env));
    if (!result.ok) yield* setExitCode(1);
    return result;
  }));
})).pipe(Command.withDescription('Inspect project configuration and onboarding gaps without running tests.'));

export { diagnose };
