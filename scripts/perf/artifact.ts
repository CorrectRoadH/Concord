import { installationRootForBin } from '../../src/base/installation/index.js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { packageBin } from '../package-location.js';
import { Effect } from 'effect';
import { io, PerfError } from './process.js';

export interface Artifact { readonly label: 'candidate' | 'baseline'; readonly dir: string; readonly entry: string; readonly commit: string; readonly dirty: boolean; readonly digest: string }

function digestDist(directory: string): string {
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
  visit(directory, 'dist');
  return `sha256:${hash.digest('hex')}`;
}

/** A built Concord checkout; the baseline is prepared before measuring, normally from the candidate's parent commit. */
export const loadArtifact = Effect.fn('perf.loadArtifact')(function*(label: Artifact['label'], path: string, installedEntry?: string) {
  const dir = yield* io('Resolve artifact', () => realpathSync(resolve(path)));
  const entry = installedEntry ?? packageBin(dir);
  if (!(yield* io('Find artifact', () => existsSync(entry)))) return yield* new PerfError({ message: `${label} artifact has no build: ${entry}; run vp build there first` });
  const git = (...args: string[]) => Effect.tryPromise({ try: () => new Promise<string>((accept, reject) => execFile('git', ['-C', dir, ...args], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : accept(stdout.trim()))), catch: cause => new PerfError({ message: `Identify artifact: ${String(cause)}` }) });
  const commit = yield* git('rev-parse', 'HEAD'), dirty = (yield* git('status', '--porcelain')) !== '';
  const digest = yield* io('Digest artifact', () => digestDist(join(installedEntry === undefined ? dir : installationRootForBin(installedEntry), 'dist')));
  return { label, dir, entry, commit, dirty, digest } satisfies Artifact;
});

export function environment() {
  return { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length, memoryBytes: totalmem() };
}
