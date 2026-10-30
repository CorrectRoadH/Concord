#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { enableCompileCache } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { StartupData } from './cli-startup-types.js';

// Enable before any dynamic application import. Node treats disabled or
// unwritable caches as an optimization failure, without changing CLI results.
enableCompileCache(process.env.NODE_COMPILE_CACHE ?? join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'node-compile-cache'));

const source = import.meta.url.endsWith('.ts');
const digest = (url: URL): string => createHash('sha256').update(readFileSync(url)).digest('hex');
const args = process.argv.slice(2);

async function startupData(): Promise<StartupData | undefined> {
  try {
    const location = source ? '../dist/startup-data.js' : './startup-data.js';
    // This is generated executable package code, not consumer-authored JSON.
    // The build strictly decodes every recorded process result before emission.
    const data = (await import(new URL(location, import.meta.url).href) as { default: StartupData }).default;
    if (data.format !== 'concord.startup/v1' || digest(new URL('../package.json', import.meta.url)) !== data.packageDigest) return;
    for (const [file, expected] of Object.entries(source ? data.sourceFiles : data.files)) {
      if (digest(new URL(file, import.meta.url)) !== expected) return;
    }
    return data;
  } catch { return; }
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
    await import('./entry-full.js');
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
        try { run = await (await import('./cli.js')).loadCommand(group, data); }
        catch { /* Missing or mismatched command code uses the complete bundle. */ }
      }
      if (run === undefined) await import('./entry-full.js');
      else run();
    }
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'OperationFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
