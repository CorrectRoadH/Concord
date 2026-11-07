// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#typescript-编译器
import { runCompilerSupervisor } from '../../base/process/typescript-supervisor.ts';

declare const CONCORD_COMPILER_PACKAGE_ROOT: string;
await runCompilerSupervisor(CONCORD_COMPILER_PACKAGE_ROOT, process.argv.slice(2));
