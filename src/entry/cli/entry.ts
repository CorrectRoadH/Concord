#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import type { fullProgram } from './entry-full.ts';
import type { loadCommand } from './cli.ts';
import { startupData, initializeNodeCompileCache } from "../../app/startup/index.ts";
import type { StartupData } from "../../model/index.ts";

// Enable before any dynamic application import. Node treats disabled or
// unwritable caches as an optimization failure, without changing CLI results.
initializeNodeCompileCache();

const args = process.argv.slice(2);
const cwd = process.cwd(), env = Object.freeze({ ...process.env });
async function start(program: ReturnType<typeof fullProgram>): Promise<void> {
  const Effect = await import('effect/Effect');
  const NodeRuntime = await import('@effect/platform-node/NodeRuntime');
  const NodeServices = await import('@effect/platform-node/NodeServices');
  const { cliEnvironmentLayer } = await import('./main.ts');
  NodeRuntime.runMain(program.pipe(
    Effect.tap(code => Effect.sync(() => { process.exitCode = code; })),
    // The real startup owns this descriptor. Stdio deliberately leaves it open,
    // while a completed command (including LSP failure) must let Node terminate.
    Effect.ensuring(Effect.sync(() => { process.stdin.destroy(); })),
    Effect.provide(cliEnvironmentLayer(cwd, env)),
    Effect.provide(NodeServices.layer),
  ));
}

function selectedGroup(data: StartupData): string | undefined {
  // Let Effect own parsing. This conservative scan only chooses a module graph;
  // values, aliases, built-ins, unknown flags and -- still use the original parser.
  if (args.some(arg => /^(?:--(?:help|version|completions|wizard)(?:=|$)|-[hv])/u.test(arg))) return;
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (['--json', '--fresh', '--dry-run'].includes(arg) || /^(?:--json|--fresh|--dry-run)=(?:true|false)$/u.test(arg)) { index++; continue; }
    if (arg.startsWith('--root=') || arg.startsWith('--server=')) { index++; continue; }
    if ((arg === '--root' || arg === '--server') && args[index + 1] !== undefined && !args[index + 1]!.startsWith('-')) { index += 2; continue; }
    return data.groups.find(item => item.name === arg)?.name;
  }
}

try {
  if (args.includes('--skill')) {
    await start((await import("./entry-full.ts")).fullProgram(args));
  } else {
    const data = await startupData();
    // Effect's pinned formatter uses no colors for non-TTY output. Restrict the
    // shortcut to the exact environment used to generate and verify receipts.
    const plain = process.env.NO_COLOR === '1' && process.env.TERM === 'dumb'
      && !process.stdin.isTTY && !process.stdout.isTTY && !process.stderr.isTTY
      && process.env.FORCE_COLOR === undefined;
    const captured = plain ? data?.receipts[JSON.stringify(args)] : undefined;
    const receipt = captured;
    if (receipt !== undefined) {
      process.stdout.write(receipt.stdout);
      process.stderr.write(receipt.stderr);
      process.exitCode = receipt.status;
    } else {
      const group = data === undefined ? undefined : selectedGroup(data);
      let command: Awaited<ReturnType<typeof loadCommand>> | undefined;
      if (group !== undefined && data !== undefined) {
        try {
          command = await (await import("./cli.ts")).loadCommand(group, data);
        }
        catch { /* Missing or mismatched command code uses the complete bundle. */ }
      }
      if (command === undefined) await start((await import("./entry-full.ts")).fullProgram(args));
      else await start((await import("./main.ts")).runCommand(command, args));
    }
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'OperationFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
