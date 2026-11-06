import { packConcord } from '../release-package.ts';
import { workspaceInstallationIdentity, installationRootForBin } from '../../src/base/installation/index.ts';
import { createHash } from 'node:crypto';
import { cpus, totalmem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageBin } from '../package-location.ts';
import { Effect, FileSystem, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { BuildIdentity } from '../build-identity.ts';
import { io, mustRun, PerfError } from './process.ts';

export interface Artifact { readonly label: 'candidate' | 'baseline'; readonly dir: string; readonly entry: string; readonly commit: string; readonly dirty: boolean; readonly digest: string }

const digestDist = Effect.fn('perf.digestDist')(function*(directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const hash = createHash('sha256');
  const visit = Effect.fn('perf.digestDist.visit')(function*(folder: string, prefix: string): Effect.fn.Return<void, PlatformError> {
    for (const entry of (yield* fs.readDirectory(folder)).sort((a, b) => a.localeCompare(b))) {
      const path = join(folder, entry), name = `${prefix}/${entry}`;
      if ((yield* Effect.result(fs.readLink(path)))._tag === 'Success') continue;
      const info = yield* fs.stat(path);
      if (info.type === 'Directory') yield* visit(path, name);
      else if (info.type === 'File' && /(?:\.js|\.node|(?:artifact|build-identity)\.json)$/u.test(entry)) {
        hash.update(name); hash.update('\0'); hash.update(yield* fs.readFile(path)); hash.update('\0');
      }
    }
  });
  yield* visit(directory, 'dist');
  return `sha256:${hash.digest('hex')}`;
});

const installArtifact = Effect.fn('perf.installArtifact')(function*(repository: string) {
  const fs = yield* FileSystem.FileSystem;
  const scratch = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-bench-install-' });
  const artifact = yield* packConcord(scratch, repository);
  yield* fs.writeFileString(join(scratch, 'package.json'), '{"private":true}');
  yield* fs.copyFile(join(repository, 'pnpm-workspace.yaml'), join(scratch, 'pnpm-workspace.yaml'));
  yield* mustRun(['pnpm', 'add', '--ignore-scripts', '--prefer-offline', '--save-exact', artifact.filename], { cwd: scratch, outputDir: scratch, timeoutMs: 120_000 });
  return yield* packageBin(join(scratch, 'node_modules/concord-sdlc'));
});

/** Identify the supplied installation; retain its source repository for consumer fixtures. */
export const loadArtifact = Effect.fn('perf.loadArtifact')(function*(label: Artifact['label'], path: string, installedEntry?: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.realPath(resolve(path));
  const built = yield* packageBin(dir);
  const entry = installedEntry ?? (label === 'candidate' ? built : ((yield* fs.exists(built)) ? yield* installArtifact(dir) : built));
  if (!(yield* fs.exists(entry))) return yield* new PerfError({ message: `${label} artifact has no build: ${entry}; run vp build there first` });
  const git = (...args: string[]) => mustRun(['git', '-C', dir, ...args], { cwd: dir, outputDir: dir }).pipe(Effect.map(result => result.stdout.trim()));
  const source = entry.endsWith('.ts');
  const distribution = join(installationRootForBin(entry), 'dist');
  const identityPath = join(distribution, 'build-identity.json');
  const identityBytes = (yield* fs.exists(identityPath)) ? yield* fs.readFileString(identityPath) : undefined;
  const identity = yield* io('Read build identity', () => identityBytes === undefined ? undefined : Schema.decodeUnknownSync(Schema.fromJsonString(BuildIdentity), { onExcessProperty: 'error' })(identityBytes));
  const commit = identity?.commit ?? (yield* git('rev-parse', 'HEAD'));
  const dirty = identity?.dirty ?? ((yield* git('status', '--porcelain')) !== '');
  const digest = source ? yield* io('Identify source installation', () => workspaceInstallationIdentity()) : yield* digestDist(distribution);
  return { label, dir, entry, commit, dirty, digest } satisfies Artifact;
});

/** Concurrent source commits do not change an already built installation. */
export const verifyArtifact = Effect.fn('perf.verifyArtifact')(function*(artifact: Artifact) {
  const distribution = join(installationRootForBin(artifact.entry), 'dist');
  const digest = artifact.entry.endsWith('.ts') ? yield* io('Identify source installation', () => workspaceInstallationIdentity()) : yield* digestDist(distribution);
  if (digest !== artifact.digest) {
    return yield* new PerfError({ message: `${artifact.label} artifact changed during measurement` });
  }
});

export function environment() {
  return { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length, memoryBytes: totalmem() };
}
