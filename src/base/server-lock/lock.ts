// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { acquireFileLock, FileLockFailure } from '../file-lock/index.ts';

const Reason = Schema.Literals(['permission', 'io', 'type', 'identity', 'closed', 'native']);
export class ServerLockUnavailable extends Schema.TaggedError<ServerLockUnavailable>()('ServerLockUnavailable', {
  reason: Reason, message: Schema.String,
}) {}
export class ServerLockHeld extends Schema.TaggedError<ServerLockHeld>()('ServerLockHeld', { message: Schema.String }) {}
export interface ServerLockIdentity { readonly device: string; readonly inode: string }
export interface ServerLockHandle {
  readonly identity: ServerLockIdentity;
  readonly verify: Effect.Effect<void, ServerLockUnavailable>;
  readonly close: Effect.Effect<void>;
}
function failure(cause: unknown): ServerLockUnavailable | ServerLockHeld {
  if (cause instanceof FileLockFailure) return cause.reason === 'busy'
    ? new ServerLockHeld({ message: cause.message })
    : new ServerLockUnavailable({ reason: cause.reason, message: cause.message });
  return new ServerLockUnavailable({ reason: 'native', message: cause instanceof Error ? cause.message : String(cause) });
}
/** The caller creates the canonical server directory before admission. */
export const acquireServerLock = Effect.fn('acquireServerLock')(function*(serverDirectory: string) {
  return yield* Effect.try({ try: (): ServerLockHandle => {
    const lock = acquireFileLock(join(serverDirectory, 'lock'));
    return { identity: lock.identity, verify: Effect.try({ try: lock.verify, catch: cause => {
      const error = failure(cause);
      return error._tag === 'ServerLockHeld' ? new ServerLockUnavailable({ reason: 'native', message: error.message }) : error;
    } }), close: Effect.sync(lock.close) };
  }, catch: failure });
});
export const scopedServerLock = (serverDirectory: string) => Effect.acquireRelease(acquireServerLock(serverDirectory), handle => handle.close);
