// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { fullCommand } from "./cli-full.ts";
import { runCli } from "./main.ts";
runCli(fullCommand);
