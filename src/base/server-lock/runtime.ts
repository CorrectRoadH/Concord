// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Layer, Schema } from 'effect';
import { ConcordError, digest, failure } from '../../model/index.ts';
import { workspaceInstallationIdentity, packageRoot, sourceInstallation, installationUseMarker } from '../installation/index.ts';
import { ensureGenericPrivateDirectorySync } from '../publication/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment, runtimePath, runtimeTemporaryDirectory, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { scopedServerLock } from './index.ts';

const Identity = Schema.Struct({ device: Schema.String, inode: Schema.String });
export const ServerRecord = Schema.Struct({
  state: Schema.Literals(['opening', 'running', 'degraded', 'draining', 'clearing', 'maintaining', 'blocked', 'stopping']),
  pid: Schema.Int, startedAt: Schema.String, token: Schema.String,
  lock: Identity, installation: Schema.String, protocol: Schema.String,
  sourceDigest: Schema.optional(Schema.String),
  socket: Schema.Struct({ path: Schema.String, device: Schema.String, inode: Schema.String }),
});
export type ServerRecord = typeof ServerRecord.Type;
export function serverInstallation(runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})) { return sourceInstallation ? digest(`source:${realpathSync(packageRoot)}`) : workspaceInstallationIdentity(runtime); }
export function serverSourceDigest(runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})) { return sourceInstallation ? workspaceInstallationIdentity(runtime) : undefined; }
export const serverCwd = packageRoot;
const identity = (path: string) => {
  const stat = lstatSync(path, { bigint: true });
  return { device: String(stat.dev), inode: String(stat.ino) };
};
const serviceLockReleased = Effect.fn('serviceLockReleased')(function*(privateDir: string) {
  const directory = join(privateDir, 'server');
  const stat = yield* Effect.try({ try: () => lstatSync(directory, { throwIfNoEntry: false }), catch: failure });
  if (!stat) return true;
  return yield* Effect.scoped(scopedServerLock(directory).pipe(
    Effect.as(true), Effect.catch(error => error._tag === 'ServerLockHeld' ? Effect.succeed(false) : Effect.fail(error)),
  ));
});
const serviceProcessExited = Effect.fn('ServerRuntime.processExited')(function*(pid: number) {
  return yield* Effect.try({ try: () => {
    try {
      process.kill(pid, 0);
      if (process.platform !== 'linux') return false;
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // Zombies have completed execution; only their parent can reap them.
      return /^[ZX] /u.test(stat.slice(stat.lastIndexOf(')') + 2));
    } catch (cause) {
      if (['ESRCH', 'ENOENT'].includes((cause as NodeJS.ErrnoException).code ?? '')) return true;
      throw cause;
    }
  }, catch: failure });
});
export function readServerRecord(privateDir: string, requireSocket = true): ServerRecord | undefined {
  const path = join(privateDir, 'server', 'current.json');
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024) throw new ConcordError('WorkspaceServerUnavailable', 'Server record must be a bounded regular file');
  let contents: string;
  try { contents = readFileSync(path, 'utf8'); }
  catch (cause) {
    // The owner removes its record before releasing the service lock. Readers
    // still use that lock to distinguish shutdown from an active owner.
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConcordError('WorkspaceServerUnavailable', 'Invalid server record');
  }
  try {
    const record = Schema.decodeUnknownSync(Schema.fromJsonString(ServerRecord), { onExcessProperty: 'error' })(contents);
    const lock = identity(join(privateDir, 'server', 'lock'));
    if (lock.device !== record.lock.device || lock.inode !== record.lock.inode) throw new Error('Server lock identity changed');
    if (!requireSocket) return record;
    const socket = lstatSync(record.socket.path, { bigint: true });
    if (lock.device !== record.lock.device || lock.inode !== record.lock.inode || !record.socket.path.endsWith(`/${digest(privateDir).slice(7, 39)}.sock`) || !socket.isSocket() || String(socket.dev) !== record.socket.device || String(socket.ino) !== record.socket.inode || socket.uid !== BigInt(process.getuid?.() ?? -1) || (socket.mode & 0o777n) !== 0o600n) throw new Error('Server identity changed');
    return record;
  }
  catch { throw new ConcordError('WorkspaceServerUnavailable', 'Invalid server record'); }
}
export const acquireServerRuntime = Effect.fn('acquireServerRuntime')(function*(root: string, privateDir: string) {
  const runtime = yield* RuntimeEnvironment;
  yield* Effect.try({ try: () => {
    ensureGenericPrivateDirectorySync(root, privateDir, runtime.env);
    const directory = join(privateDir, 'server');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw new ConcordError('ServerLockUnavailable', 'Server directory must be owned by the user with mode 0700');
  }, catch: failure });
  const directory = join(privateDir, 'server');
  const lock = yield* scopedServerLock(directory);
  yield* installationUseMarker(packageRoot, sourceInstallation, runtime);
  const recordPath = join(directory, 'current.json');
  const socketPath = yield* Effect.try({ try: () => {
    const runtimeDirectory = realpathSync(runtime.env.XDG_RUNTIME_DIR === undefined ? runtimeTemporaryDirectory(runtime) : runtimePath(runtime, runtime.env.XDG_RUNTIME_DIR));
    const parent = join(runtimeDirectory, `concord-${process.getuid?.() ?? 'user'}`);
    try { mkdirSync(parent, { mode: 0o700 }); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
    return parent;
  }, catch: failure }).pipe(Effect.flatMap(parent => Effect.try({ try: () => {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw new ConcordError('WorkspaceServerUnavailable', 'Runtime directory must be user-owned, nonsymlink and mode 0700');
    const path = join(parent, `${digest(privateDir).slice('sha256:'.length, 'sha256:'.length + 32)}.sock`);
    if (Buffer.byteLength(path) > 107) throw new ConcordError('WorkspaceServerUnavailable', 'Socket path exceeds the platform limit');
    const stale = lstatSync(path, { throwIfNoEntry: false });
    if (stale) {
      if (!stale.isSocket() || stale.uid !== process.getuid?.()) throw new ConcordError('WorkspaceServerUnavailable', 'Refusing to remove an unexpected socket path');
      unlinkSync(path);
    }
    return path;
  }, catch: failure })));
  const token = randomUUID();
  const installation = serverInstallation(runtime);
  const sourceDigest = serverSourceDigest(runtime);
  let current: ServerRecord | undefined;
  const publish = (state: ServerRecord['state']) => Effect.gen(function*() {
    yield* lock.verify;
    yield* Effect.try({ try: () => {
      chmodSync(socketPath, 0o600);
      const socket = { path: socketPath, ...identity(socketPath) };
      if (current && (current.socket.device !== socket.device || current.socket.inode !== socket.inode)) throw new ConcordError('ServerLockUnavailable', 'Socket identity changed');
      current = { state, token, pid: process.pid, startedAt: current?.startedAt ?? new Date().toISOString(), lock: lock.identity, installation, protocol: 'concord.workspace/v2', socket, ...(sourceDigest === undefined ? {} : { sourceDigest }) };
      const temporary = join(directory, `current-${token}.tmp`);
      try { writeFileSync(temporary, `${JSON.stringify(current)}\n`, { flag: 'wx', mode: 0o600 }); renameSync(temporary, recordPath); }
      finally { try { unlinkSync(temporary); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; } }
    }, catch: failure });
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => {
    // A replaced Git-private directory belongs to a different service instance.
    try {
      const record = readServerRecord(privateDir, false);
      if (record?.token === token && record.lock.device === lock.identity.device && record.lock.inode === lock.identity.inode) unlinkSync(recordPath);
    } catch { /* Never delete an unverified record. */ }
    if (current) try {
      const actual = identity(socketPath);
      if (actual.device === current.socket.device && actual.inode === current.socket.inode) unlinkSync(socketPath);
    } catch { /* A missing or replaced socket is not ours. */ }
  }));
  return { token, socketPath, publish, verify: lock.verify };
});
export class ServerRuntime extends Context.Service<ServerRuntime, {
  readonly acquire: (root: string, privateDir: string) => Effect.Effect<Effect.Success<ReturnType<typeof acquireServerRuntime>>, Effect.Error<ReturnType<typeof acquireServerRuntime>>, Exclude<Effect.Services<ReturnType<typeof acquireServerRuntime>>, RuntimeEnvironment>>;
  readonly read: typeof readServerRecord;
  readonly installation: () => string;
  readonly sourceDigest: () => string | undefined;
  readonly released: (privateDir: string) => Effect.Effect<boolean, Effect.Error<ReturnType<typeof serviceLockReleased>>>;
  readonly processExited: typeof serviceProcessExited;
  readonly cwd: string;
}>()('concord/base/server-lock/ServerRuntime') {
  static readonly layer = Layer.effect(ServerRuntime, Effect.gen(function*() {
    const runtime = yield* RuntimeEnvironment;
    return ServerRuntime.of({
      acquire: (root, privateDir) => acquireServerRuntime(root, privateDir).pipe(Effect.provideService(RuntimeEnvironment, runtime)),
      read: readServerRecord, installation: () => serverInstallation(runtime), sourceDigest: () => serverSourceDigest(runtime),
      released: privateDir => serviceLockReleased(privateDir).pipe(Effect.provideService(RuntimeEnvironment, runtime)),
      processExited: serviceProcessExited, cwd: serverCwd,
    });
  }));
}
