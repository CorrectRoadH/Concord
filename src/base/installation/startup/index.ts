import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { StartupData } from "../../../model/index.ts";
import { enableCompileCache } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cache compiled files across source commands, workers and gate invocations. */
export function initializeNodeCompileCache(): string {
  const directory = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'node-compile');
  process.env.NODE_COMPILE_CACHE = directory;
  enableCompileCache(directory);
  return directory;
}

const source = import.meta.url.endsWith('.ts');
const installation = new URL('../../../../', import.meta.url);
const entry = new URL(source ? 'src/entry/cli/' : 'dist/entry/cli/', installation);
const digest = (url: URL): string => createHash('sha256').update(readFileSync(url)).digest('hex');

/** Authenticate generated installation code before using its captured output. */
export async function readStartupData(): Promise<StartupData | undefined> {
  try {
    const location = new URL('dist/startup-data.js', installation);
    // The target is a build-generated resource, never consumer-authored code.
    const data = (await import(location.href) as { default: StartupData }).default;
    const { dataDigest, ...payload } = data;
    if (createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== dataDigest) return;
    if (data.format !== 'concord.startup/v1' || digest(new URL('package.json', installation)) !== data.packageDigest) return;
    for (const [file, expected] of Object.entries(source ? data.sourceFiles : data.files)) {
      if (digest(new URL(file, entry)) !== expected) return;
    }
    return data;
  } catch { return; }
}
