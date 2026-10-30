// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#结果
import { Command } from "effect/unstable/cli";
import { doctor } from "../../app/index.js";
import { sync } from "./cli-base.js";
import { withReadRepo } from "./cli-repository.js";

const diagnose = Command.make('doctor', {}, () => withReadRepo(repo => sync(() => { const result = doctor(repo); if (!result.ok) process.exitCode = 1; return result; }))).pipe(Command.withDescription('Inspect project configuration and onboarding gaps without running tests.'));

export { diagnose };
