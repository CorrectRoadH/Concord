import { workspaceInstallationIdentity, installationRootForBin, archiveRootForApplication } from '../../src/base/installation/index.ts';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { packageBin } from '../package-location.ts';
import { Effect, FileSystem, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { BuildIdentity } from '../build-identity.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { io, mustRun, PerfError } from './process.ts';

export interface Artifact { readonly label: 'candidate' | 'baseline'; readonly dir: string; readonly entry: string; readonly commit: string; readonly dirty: boolean; readonly digest: string }

const digestDist = Effect.fn('perf.digestDist')(function*(directory: string, all = false) {
  const fs = yield* FileSystem.FileSystem;
  const hash = createHash('sha256');
  const visit = Effect.fn('perf.digestDist.visit')(function*(folder: string, prefix: string): Effect.fn.Return<void, PlatformError> {
    for (const entry of (yield* fs.readDirectory(folder)).sort((a, b) => a.localeCompare(b))) {
      const path = join(folder, entry), name = `${prefix}/${entry}`;
      if ((yield* Effect.result(fs.readLink(path)))._tag === 'Success') continue;
      const info = yield* fs.stat(path);
      if (info.type === 'Directory') yield* visit(path, name);
      else if (info.type === 'File' && (all || /(?:\.js|\.node|(?:artifact|build-identity)\.json)$/u.test(entry))) {
        hash.update(name); hash.update('\0'); hash.update(yield* fs.readFile(path)); hash.update('\0');
      }
    }
  });
  yield* visit(directory, 'dist');
  return `sha256:${hash.digest('hex')}`;
});

const digestInstallation = Effect.fn('perf.digestInstallation')(function*(entry: string) {
  const app = installationRootForBin(entry);
  const archive = archiveRootForApplication(app);
  if (archive === undefined) return yield* digestDist(join(app, 'dist'));
  const hash = createHash('sha256');
  // Exclude mutable service usage markers and the redundant compressed archive.
  for (const directory of ['app', 'bin', 'runtime', 'licenses']) {
    hash.update(directory); hash.update(yield* digestDist(join(archive, directory), true));
  }
  return `sha256:${hash.digest('hex')}`;
});

/** Identify the supplied installation; retain its source repository for consumer fixtures. */
export const loadArtifact = Effect.fn('perf.loadArtifact')(function*(label: Artifact['label'], path: string, installedEntry?: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.realPath(resolve(path));
  const entry = installedEntry ?? (yield* packageBin(dir));
  if (!(yield* fs.exists(entry))) return yield* new PerfError({ message: `${label} artifact has no build: ${entry}; run vp build there first` });
  const git = (...args: string[]) => mustRun(['git', '-C', dir, ...args], { cwd: dir, outputDir: dir }).pipe(Effect.map(result => result.stdout.trim()));
  const source = entry.endsWith('.ts');
  const distribution = join(installationRootForBin(entry), 'dist');
  const identityPath = join(distribution, 'build-identity.json');
  const identityBytes = (yield* fs.exists(identityPath)) ? yield* fs.readFileString(identityPath) : undefined;
  const identity = yield* io('Read build identity', () => identityBytes === undefined ? undefined : Schema.decodeUnknownSync(Schema.fromJsonString(BuildIdentity), { onExcessProperty: 'error' })(identityBytes));
  const commit = identity?.commit ?? (yield* git('rev-parse', 'HEAD'));
  const dirty = identity?.dirty ?? ((yield* git('status', '--porcelain')) !== '');
  const digest = source ? yield* io('Identify source installation', () => workspaceInstallationIdentity(makeRuntimeEnvironment(process.cwd(), process.env))) : yield* digestInstallation(entry);
  return { label, dir, entry, commit, dirty, digest } satisfies Artifact;
});

/** Concurrent source commits do not change an already built installation. */
export const verifyArtifact = Effect.fn('perf.verifyArtifact')(function*(artifact: Artifact) {
  const digest = artifact.entry.endsWith('.ts') ? yield* io('Identify source installation', () => workspaceInstallationIdentity(makeRuntimeEnvironment(process.cwd(), process.env))) : yield* digestInstallation(artifact.entry);
  if (digest !== artifact.digest) {
    return yield* new PerfError({ message: `${artifact.label} artifact changed during measurement` });
  }
});

export function environment() {
  return { node: process.version, bun: execFileSync('bun', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(), platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length, memoryBytes: totalmem() };
}
