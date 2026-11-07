// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { runComputeMain } from './main.ts';
export function run(): void {
  runComputeMain(process.argv[2]);
}
