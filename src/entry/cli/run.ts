// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import type { Effect as EffectType, FileSystem, Stdio, Terminal } from 'effect';
import type { fullProgram } from './entry-full.ts';
import type { StartupReceipt } from "../../model/index.ts";

declare const CONCORD_STARTUP_RECEIPTS: Readonly<Record<string, StartupReceipt>>;

async function start(program: ReturnType<typeof fullProgram>, cwd: string, env: Readonly<NodeJS.ProcessEnv>): Promise<void> {
  const Effect = await import('effect/Effect');
  const { cliEnvironmentLayer } = await import('./main.ts');
  await launch(program.pipe(Effect.provide(cliEnvironmentLayer(cwd, env))));
}

async function launch(program: EffectType.Effect<number, unknown, FileSystem.FileSystem | Stdio.Stdio | Terminal.Terminal>): Promise<void> {
  const Effect = await import('effect/Effect');
  const NodeRuntime = await import('@effect/platform-node/NodeRuntime');
  const NodeServices = await import('@effect/platform-node/NodeServices');
  NodeRuntime.runMain(program.pipe(
    Effect.tap(code => Effect.sync(() => { process.exitCode = code; })),
    // The real startup owns this descriptor. Stdio deliberately leaves it open,
    // while a completed command (including LSP failure) must let the runtime terminate.
    Effect.ensuring(Effect.sync(() => { process.stdin.destroy(); })),
    Effect.provide(NodeServices.layer),
  ));
}

export async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd(), env = Object.freeze({ ...process.env });
  const embedded = typeof CONCORD_STARTUP_RECEIPTS === 'undefined' ? undefined : CONCORD_STARTUP_RECEIPTS;
  const plainStartup = env.NO_COLOR === '1' && env.TERM === 'dumb' && env.FORCE_COLOR === undefined
    && !process.stdin.isTTY && !process.stdout.isTTY && !process.stderr.isTTY;
  const startupReceipt = plainStartup ? embedded?.[JSON.stringify(args)] : undefined;
  if (startupReceipt !== undefined) {
    process.stdout.write(startupReceipt.stdout);
    process.stderr.write(startupReceipt.stderr);
    process.exitCode = startupReceipt.status;
    return;
  }
  try {
    if (args.includes('--skill')) {
      await launch((await import("./skill.ts")).skillCommand(args));
    } else {
      await start((await import("./entry-full.ts")).fullProgram(args), cwd, env);
    }
  } catch (cause) {
    const error = cause as { code?: string; message?: string };
    process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'OperationFailed', message: error.message ?? String(cause) }) + '\n');
    process.exitCode = 1;
  }
}
