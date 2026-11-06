import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

export class ArchiveFailed extends Schema.TaggedError<ArchiveFailed>()('ArchiveFailed', { message: Schema.String }) {}
export class UnsupportedTarget extends Schema.TaggedError<UnsupportedTarget>()('UnsupportedTarget', { message: Schema.String }) {}
export const Target = Schema.Literals(['linux-x64', 'darwin-arm64']);
export type ArchiveTarget = typeof Target.Type;
export const archiveTarget = (value: unknown = process.env.CONCORD_TARGET ?? `${process.platform}-${process.arch}`): ArchiveTarget => {
  try { return Schema.decodeUnknownSync(Target)(value); }
  catch { throw new UnsupportedTarget({ message: `Unsupported target ${String(value)}; supported targets: linux-x64, darwin-arm64` }); }
};
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const attempt = <A>(operation: () => Promise<A>) => Effect.tryPromise({ try: operation, catch: cause => new ArchiveFailed({ message: String(cause) }) });
export const command = Effect.fn('archive.command')(function*(executable: string, args: readonly string[], cwd?: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.string(ChildProcess.make(executable, args, { cwd, stderr: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } }));
});
export const run = Effect.fn('archive.run')(function*(executable: string, args: readonly string[], cwd?: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = Number(yield* spawner.exitCode(ChildProcess.make(executable, args, { cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', env: { ...process.env, CI: 'true', COPYFILE_DISABLE: '1' } })));
  if (code !== 0) return yield* new ArchiveFailed({ message: `${executable} exited ${code}` });
});
export const readJson = <S extends Schema.Top>(path: string, schema: S) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { onExcessProperty: 'error' })(yield* fs.readFileString(path));
});
export const runtimeCacheRoot = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/runtime');
/** Content-addressed downloads never publish unverified bytes. */
export const verifiedDownload = Effect.fn('archive.download')(function*(url: string, digest: string, cache = runtimeCacheRoot()) {
  const fs = yield* FileSystem.FileSystem;
  yield* Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)))(digest);
  yield* fs.makeDirectory(cache, { recursive: true });
  const destination = join(cache, digest);
  if (yield* fs.exists(destination)) {
    if (sha256(yield* fs.readFile(destination)) !== digest) return yield* new ArchiveFailed({ message: `Corrupt runtime cache: ${digest}` });
    return destination;
  }
  const staging = join(cache, `.download-${randomUUID()}`);
  yield* Effect.acquireRelease(Effect.succeed(staging), path => fs.remove(path, { force: true }).pipe(Effect.orDie));
  yield* run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '180', '--output', staging, url]);
  if (sha256(yield* fs.readFile(staging)) !== digest) return yield* new ArchiveFailed({ message: `SHA-256 mismatch: ${url}` });
  yield* fs.rename(staging, destination);
  return destination;
});
