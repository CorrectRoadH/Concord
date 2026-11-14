// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { dlopen, FFIType, read } from 'bun:ffi';
import { closeSync, constants, fstatSync, lstatSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getSystemErrorName } from 'node:util';
import { Schema } from 'effect';

export class FileLockFailure extends Schema.TaggedError<FileLockFailure>()('FileLockFailure', {
  reason: Schema.Literals(['busy', 'permission', 'io', 'type', 'identity', 'closed', 'native']), message: Schema.String,
}) {}
export interface FileLock {
  readonly identity: { readonly device: string; readonly inode: string };
  verify(): void;
  close(): void;
}
let system: ReturnType<typeof loadSystem> | undefined;
function loadSystem() {
  // Effect has no nonblocking OS file-lock primitive or descriptor identity check.
  const library = dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  const errors = process.platform === 'darwin'
    ? dlopen('/usr/lib/libSystem.B.dylib', { __error: { args: [], returns: FFIType.ptr } })
    : dlopen('libc.so.6', { __errno_location: { args: [], returns: FFIType.ptr } });
  return { library, errors, flock: library.symbols.flock, errno: () => {
    const pointer = '__error' in errors.symbols ? errors.symbols.__error() : errors.symbols.__errno_location();
    if (pointer === null) throw new FileLockFailure({ reason: 'native', message: 'Cannot read the system lock error' });
    return getSystemErrorName(-read.i32(pointer));
  } };
}
function failure(cause: unknown): FileLockFailure {
  if (cause instanceof FileLockFailure) return cause;
  const code = cause instanceof Error && 'code' in cause ? cause.code : undefined;
  return new FileLockFailure({ reason: code === 'EACCES' || code === 'EPERM' ? 'permission' : code === 'ELOOP' ? 'type' : 'io', message: cause instanceof Error ? cause.message : String(cause) });
}
/** File descriptors own locks. Lock files are never removed or replaced. */
export function acquireFileLock(input: string, create = true): FileLock {
  const path = resolve(input);
  let descriptor: number | undefined;
  try {
    const ancestors = new Map<string, { dev: bigint; ino: bigint }>();
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      const stat = lstatSync(parent, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new FileLockFailure({ reason: 'type', message: `Lock ancestor is not a real directory: ${parent}` });
      ancestors.set(parent, { dev: stat.dev, ino: stat.ino });
      if (parent === dirname(parent)) break;
    }
    const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)) throw new FileLockFailure({ reason: 'type', message: `Lock must be a single-link regular file: ${path}` });
    descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK | (create ? constants.O_CREAT : 0), 0o600);
    const fd = descriptor, owned = fstatSync(fd, { bigint: true });
    if (!owned.isFile() || owned.nlink !== 1n) throw new FileLockFailure({ reason: 'type', message: `Invalid lock file: ${path}` });
    if (before && (before.dev !== owned.dev || before.ino !== owned.ino)) throw new FileLockFailure({ reason: 'identity', message: `Lock changed during open: ${path}` });
    let closed = false;
    const verify = () => {
      if (closed) throw new FileLockFailure({ reason: 'closed', message: `Lock is closed: ${path}` });
      try {
        for (const [parent, expected] of ancestors) {
          const current = lstatSync(parent, { bigint: true });
          if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino) throw new FileLockFailure({ reason: 'identity', message: `Lock ancestor changed: ${parent}` });
        }
        const current = lstatSync(path, { bigint: true }), open = fstatSync(fd, { bigint: true });
        if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n || open.nlink !== 1n || current.dev !== owned.dev || current.ino !== owned.ino || open.dev !== owned.dev || open.ino !== owned.ino) throw new FileLockFailure({ reason: 'identity', message: `Lock identity changed: ${path}` });
      } catch (cause) {
        if (cause instanceof FileLockFailure) throw cause;
        throw new FileLockFailure({ reason: 'identity', message: `Cannot verify lock ${path}: ${String(cause)}` });
      }
    };
    verify();
    const native = system ??= loadSystem();
    while (native.flock(fd, 2 | 4) !== 0) {
      const code = native.errno();
      if (code === 'EINTR') continue;
      throw new FileLockFailure({ reason: code === 'EAGAIN' || code === 'EWOULDBLOCK' ? 'busy' : code === 'EACCES' || code === 'EPERM' ? 'permission' : 'io', message: `Cannot acquire lock ${path}: ${code}` });
    }
    verify();
    return { identity: { device: String(owned.dev), inode: String(owned.ino) }, verify, close: () => {
      if (closed) return;
      closed = true;
      closeSync(fd);
    } };
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw failure(cause);
  }
}
