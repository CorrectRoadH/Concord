import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { io, PerfError } from './process.js';

export interface Artifact { readonly label: 'candidate' | 'baseline'; readonly dir: string; readonly entry: string; readonly commit: string; readonly dirty: boolean; readonly digest: string }

function digestDist(dir: string): string {
  const hash = createHash('sha256');
  const visit = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name), name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(path, name);
      else if (entry.isFile() && /(?:\.js|\.node|artifact\.json)$/u.test(entry.name)) {
        hash.update(name); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0');
      }
    }
  };
  visit(join(dir, 'dist'), 'dist');
  return `sha256:${hash.digest('hex')}`;
}

/** A built Concord checkout; the baseline is prepared before measuring, normally from the candidate's parent commit. */
export const loadArtifact = Effect.fn('perf.loadArtifact')(function*(label: Artifact['label'], path: string) {
  const dir = yield* io('Resolve artifact', () => realpathSync(resolve(path)));
  const entry = join(dir, 'dist/entry.js');
  if (!(yield* io('Find artifact', () => existsSync(entry)))) return yield* new PerfError({ message: `${label} artifact has no build: ${entry}; run pnpm build there first` });
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return yield* io('Identify artifact', () => ({ label, dir, entry, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '', digest: digestDist(dir) } satisfies Artifact));
});

export function environment() {
  return { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length, memoryBytes: totalmem() };
}
