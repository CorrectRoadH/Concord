// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { runWorkspaceMain } from './main.ts';
runWorkspaceMain(process.argv[2] ?? '');
