import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { acquireRecoverablePublicationLease, CoordinationError, releaseFileLease } from '../src/base/publication/file-lease.ts';
import { buildCacheTree, gateBuildDigest } from './gate-build-cache.ts';
import { ArchiveFailed, sha256 } from './archive-support.ts';
import { captureBuildSource } from './build-identity.ts';


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

/** Shared target-independent application bytes. The outer caller's scope owns
 * the lock until its archive has copied them; no target participates in the key. */
export const cachedApplication = Effect.fn('archive.applicationCache')(function*(compile: (root: string) => Promise<void>) {
  const fs = yield* FileSystem.FileSystem;
  const repository = resolve(import.meta.dirname, '..');
  const identity = yield* captureBuildSource();
  const input = yield* gateBuildDigest(repository, false);
  const digest = sha256(`${input}\0${identity.commit}`);
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/application');
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
    if ((yield* fs.readFileString(manifest)) !== JSON.stringify(entries)) return yield* new ArchiveFailed({ message: `Application cache integrity mismatch: ${output}` });
    return output;
  }
  const staging = yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: `.staging-${digest}-` });
  const app = join(staging, 'app');
  yield* Effect.tryPromise({ try: () => compile(app), catch: cause => cause });
  if ((yield* gateBuildDigest(repository, false)) !== input || (yield* captureBuildSource()).commit !== identity.commit) return yield* new ArchiveFailed({ message: 'Application inputs changed while building; retry after edits settle' });
  const entries = yield* buildCacheTree(app);
  yield* fs.writeFileString(join(app, '.application-cache.json'), JSON.stringify(entries));
  yield* fs.rename(app, output);
  return output;
});
