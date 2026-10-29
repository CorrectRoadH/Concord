// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { fullCommand } from './cli-full.js';
import { normalizeArguments, runCli } from './cli-run.js';
normalizeArguments();
runCli(fullCommand);
