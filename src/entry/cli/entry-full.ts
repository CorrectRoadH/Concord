// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { Effect, type FileSystem, type Stdio, type Terminal } from 'effect';
import type { applicationRuntime } from '../../app/index.ts';
import { runCommand } from './main.ts';
import { skillCommand } from './skill.ts';

/** Loading command definitions has no startup or invocation side effects. */
export function fullProgram(argv: readonly string[]): Effect.Effect<number, unknown, Effect.Services<typeof applicationRuntime> | FileSystem.FileSystem | Stdio.Stdio | Terminal.Terminal> {
  if (argv.includes('--skill')) return skillCommand(argv);
  return Effect.tryPromise(() => import('./cli-fallback.ts')).pipe(Effect.flatMap(module => runCommand(module.fullCommand, argv)));
}
