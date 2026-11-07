import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Scope } from 'effect';
import type { ChildProcessSpawner } from 'effect/unstable/process';
import { Effect, FileSystem } from 'effect';
import { acquireRecoverablePublicationLease, CoordinationError, releaseFileLease } from '../src/base/publication/file-lease.ts';
import { buildCacheTree } from './gate-build-cache.ts';
import { ArchiveFailed, sha256 } from './archive-support.ts';


const pruneApplications = Effect.fn('archive.pruneApplications')(function*(cache: string) {
  const fs = yield* FileSystem.FileSystem;
  const entries: { digest: string; used: number }[] = [];
  for (const digest of (yield* fs.readDirectory(cache)).filter(name => /^[a-f0-9]{64}$/u.test(name))) {
    const used = Number(yield* fs.readFileString(join(cache, '.access', digest)).pipe(Effect.catch(() => Effect.succeed('0'))));
    entries.push({ digest, used });
  }
  entries.sort((a, b) => b.used - a.used || a.digest.localeCompare(b.digest));
  for (const { digest } of entries.slice(4)) {
    const lease = yield* Effect.try({
      try: () => acquireRecoverablePublicationLease(cache, join(cache, '.locks', digest), 'publication.lease', 'exclusive', 'application-build-cache')!,
      catch: cause => cause,
    }).pipe(Effect.catch(cause => cause instanceof CoordinationError && cause.reason === 'occupied' ? Effect.succeed(undefined) : Effect.fail(cause)));
    if (!lease) continue;
    yield* Effect.ensuring(fs.remove(join(cache, digest), { recursive: true, force: true }).pipe(Effect.andThen(fs.remove(join(cache, '.access', digest), { force: true }))), Effect.sync(() => releaseFileLease(lease, 'application-build-cache')));
  }
});

/** Hash the actual byte inputs, including untracked files and linked tools. */
export const archivePartInput = Effect.fn('archive.partInput')(function*(repository: string, paths: readonly string[], identity: unknown = null) {
  const entries = yield* buildCacheTree(repository, path => !paths.some(input => path === input || path.startsWith(`${input}/`) || input.startsWith(`${path}/`)), true);
  return sha256(JSON.stringify({ entries, identity, node: process.version, platform: process.platform, arch: process.arch }));
});

/** The caller retains a recoverable use lease through the private copy. Cache
 * bytes are verified before every use and published by one atomic rename. */
export const cachedArchivePart = Effect.fn('archive.partCache')(function*(name: string, input: string, compile: (root: string) => Effect.Effect<void, unknown, FileSystem.FileSystem | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner>, verifyInput?: () => Effect.Effect<string, unknown, FileSystem.FileSystem>, cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')) {
  const fs = yield* FileSystem.FileSystem;
  const digest = sha256(input);
  const cache = join(cacheHome, 'concord', 'parts', name);
  const output = join(cache, digest);
  yield* fs.makeDirectory(join(cache, '.access'), { recursive: true });
  for (;;) {
    const lease = yield* Effect.try({
      try: () => acquireRecoverablePublicationLease(cache, join(cache, '.locks', digest), 'publication.lease', 'exclusive', 'application-build-cache')!,
      catch: cause => cause,
    }).pipe(Effect.catch(cause => cause instanceof CoordinationError && cause.reason === 'occupied' ? Effect.succeed(undefined) : Effect.fail(cause)));
    if (lease) {
      yield* Effect.addFinalizer(() => Effect.sync(() => releaseFileLease(lease, 'application-build-cache')).pipe(Effect.andThen(pruneApplications(cache)), Effect.orDie));
      break;
    }
    yield* Effect.sleep('25 millis');
  }
  yield* fs.writeFileString(join(cache, '.access', digest), String(Date.now()));
  for (const name of yield* fs.readDirectory(cache)) if (name.startsWith(`.staging-${digest}-`)) yield* fs.remove(join(cache, name), { recursive: true, force: true });
  const manifest = join(output, '.application-cache.json');
  if (yield* fs.exists(output)) {
    const entries = yield* buildCacheTree(output, path => path === '.application-cache.json');
    if ((yield* fs.readFileString(manifest)) !== JSON.stringify(entries)) return yield* new ArchiveFailed({ message: `Archive part cache integrity mismatch: ${output}` });
    yield* Effect.sync(() => console.error(`# Archive part ${name}: hit; digest=${digest}`));
    return output;
  }
  const staging = yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: `.staging-${digest}-` });
  const app = join(staging, 'part');
  yield* compile(app);
  if (verifyInput !== undefined && (yield* verifyInput()) !== input) return yield* new ArchiveFailed({ message: `Archive part inputs changed while building: ${name}` });
  const entries = yield* buildCacheTree(app);
  yield* fs.writeFileString(join(app, '.application-cache.json'), JSON.stringify(entries));
  yield* fs.rename(app, output);
  yield* Effect.sync(() => console.error(`# Archive part ${name}: miss; digest=${digest}`));
  return output;
});
