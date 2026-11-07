// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#typescript-编译器
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';

class CompilerProcessFailed extends Schema.TaggedError<CompilerProcessFailed>()('CompilerProcessFailed', { detail: Schema.String }) {}

/** The only permitted tool is the pinned TypeScript native executable. */
export function compilerExecutable(root: string): string {
  const require = createRequire(join(root, 'package.json'));
  const compiler = createRequire(require.resolve('typescript/package.json'));
  return join(dirname(compiler.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`)), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
}

function compilerArguments(args: readonly string[]): readonly string[] {
  if (args[0] !== '--api' || args[1] !== '--async' || args[2] !== '--cwd' || !args[3] || args[4] !== '--useCaseSensitiveFileNames=true') {
    throw new CompilerProcessFailed({ detail: 'Unsupported compiler supervisor arguments' });
  }
  const callbacks = '--callbacks=realpath:identity,stat:fakeStat,writeFile:error,removeFile:error,readFile,fileExists,directoryExists,getAccessibleEntries';
  if (!args.includes(callbacks)) throw new CompilerProcessFailed({ detail: 'Compiler requires the captured filesystem' });
  for (const argument of args.slice(5)) {
    if (argument === '--timing') continue;
    if (argument === callbacks) continue;
    throw new CompilerProcessFailed({ detail: 'Compiler external code and arbitrary arguments are forbidden' });
  }
  return args;
}

/** Transparent pipes with backpressure; the native tool stays in its caller's group. */
export const superviseCompiler = (executable: string, args: readonly string[], timeoutMs = 600_000): Effect.Effect<number, CompilerProcessFailed> =>
  Effect.callback<number, CompilerProcessFailed>(resume => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(executable, [...compilerArguments(args)], { detached: false, stdio: ['pipe', 'pipe', 'inherit'] }); }
    catch (cause) { resume(Effect.fail(new CompilerProcessFailed({ detail: String(cause) }))); return; }
    let stopped = false;
    let finished = false;
    let abnormal = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (failed: boolean) => {
      abnormal ||= failed;
      if (stopped || finished) return;
      stopped = true;
      process.stdin.unpipe(child.stdin!);
      process.stdin.pause();
      child.stdin?.destroy();
      if (failed) { child.stdout?.unpipe(process.stdout); child.stdout?.destroy(); }
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (!finished) { child.stdout?.destroy(); child.kill('SIGKILL'); } }, 500);
    };
    const eof = () => stop(false);
    const interrupt = () => stop(true);
    const deadline = setTimeout(interrupt, timeoutMs);
    const cleanup = () => {
      clearTimeout(deadline);
      if (killTimer !== undefined) clearTimeout(killTimer);
      process.stdin.off('end', eof);
      process.stdin.off('error', interrupt);
      process.stdout.off('error', interrupt);
      process.off('SIGTERM', interrupt);
      process.off('SIGINT', interrupt);
      process.stdin.unpipe(child.stdin!);
      process.stdin.pause();
      child.stdout?.unpipe(process.stdout);
    };
    child.once('error', error => { abnormal = true; stop(true); process.stderr.write(`TypeScriptUnavailable: ${error.message}\n`); });
    child.once('close', (code, signal) => {
      finished = true;
      cleanup();
      resume(Effect.succeed(abnormal || signal !== null && !stopped ? 1 : code ?? (stopped ? 0 : 1)));
    });
    process.stdin.once('end', eof);
    process.stdin.once('error', interrupt);
    process.stdout.on('error', interrupt);
    process.on('SIGTERM', interrupt);
    process.on('SIGINT', interrupt);
    child.stdin!.on('error', interrupt);
    child.stdout!.on('error', interrupt);
    process.stdin.pipe(child.stdin!);
    child.stdout!.pipe(process.stdout, { end: false });
    return Effect.sync(interrupt);
  }).pipe(Effect.uninterruptible);

export async function runCompilerSupervisor(root: string, args: readonly string[]): Promise<void> {
  try { process.exitCode = await Effect.runPromise(superviseCompiler(compilerExecutable(root), args)); }
  catch (cause) { process.stderr.write(`TypeScriptUnavailable: ${cause instanceof CompilerProcessFailed ? cause.detail : String(cause)}\n`); process.exitCode = 1; }
}
