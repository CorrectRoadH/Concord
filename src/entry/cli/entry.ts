#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { startupData } from "../../app/startup/index.js";
import { enableCompileCache } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StartupData } from "../../model/index.js";

// Enable before any dynamic application import. Node treats disabled or
// unwritable caches as an optimization failure, without changing CLI results.
enableCompileCache(process.env.NODE_COMPILE_CACHE ?? join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'node-compile-cache'));

const args = process.argv.slice(2);

function exactPanelInvocation(data: StartupData): { root: string | undefined } | undefined {
  for (const form of data.panelStarts ?? []) {
    if (form.length !== args.length) continue;
    if (form.every((token, index) => token === '<root>' ? !!args[index] && !args[index]!.startsWith('-') : args[index] === token)) return { root: form.includes('<root>') ? args[form.indexOf('<root>')] : undefined };
  }
}

function selectedGroup(data: StartupData): string | undefined {
  // Let Effect own parsing. This conservative scan only chooses a module graph;
  // values, aliases, built-ins, unknown flags and -- still use the original parser.
  if (args.some(arg => /^(?:--(?:help|version|completions|wizard)(?:=|$)|-[hv])/u.test(arg))) return;
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (['--json', '--fresh', '--dry-run'].includes(arg) || /^(?:--json|--fresh|--dry-run)=(?:true|false)$/u.test(arg)) { index++; continue; }
    if (arg.startsWith('--root=')) { index++; continue; }
    if (arg === '--root' && args[index + 1] !== undefined && !args[index + 1]!.startsWith('-')) { index += 2; continue; }
    return data.groups.find(item => item.name === arg)?.name;
  }
}

try {
  if (args.includes('--skill')) {
    await import("./entry-full.js");
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
      let run: (() => void) | undefined;
      if (group !== undefined && data !== undefined) {
        try {
          if (group === 'panel') {
            const exact = exactPanelInvocation(data);
            if (exact) run = (await import('./panel-start.js')).loadPanelInvocation(exact.root);
          } else run = await (await import("./cli.js")).loadCommand(group, data);
        }
        catch { /* Missing or mismatched command code uses the complete bundle. */ }
      }
      if (run === undefined) await import("./entry-full.js");
      else run();
    }
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'OperationFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
