// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#结果
// @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
import { Command } from "effect/unstable/cli";
import { doctor, projectInitializationRequired, uninitializedDoctor } from "../../app/index.ts";
import { Effect, Option } from 'effect';
import { root, emit, sync } from "./cli-base.ts";
import { withReadRepo } from "./cli-repository.ts";

const diagnose = Command.make('doctor', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  const required = yield* sync(() => projectInitializationRequired(Option.getOrUndefined(settings.root)));
  if (required) return yield* sync(() => { const result = uninitializedDoctor(required, process.version); emit(result, settings.json); return result; });
  return yield* withReadRepo(repo => sync(() => { const result = doctor(repo); if (!result.ok) process.exitCode = 1; return result; }));
})).pipe(Command.withDescription('Inspect project configuration and onboarding gaps without running tests.'));

export { diagnose };
