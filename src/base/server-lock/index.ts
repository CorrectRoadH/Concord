// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { HAWDB_ABI, HAWDB_REVISION, decodeNativeArtifact, hawdbTarget, nativeArtifactRoot, sourceInstallation, verifySourceNativeArtifact } from '../installation/index.js';
import type { NativeServerLock, ServerLockBinding } from './native.js';
export { acquireServerRuntime, readServerRecord, serverInstallation, serverCwd, ServerRecord, ServerRuntime } from './runtime.js';

const Reason = Schema.Literals(['permission', 'io', 'type', 'identity', 'closed', 'native']);
export class ServerLockUnavailable extends Schema.TaggedError<ServerLockUnavailable>()('ServerLockUnavailable', {
  reason: Reason, message: Schema.String,
}) {}
export class ServerLockHeld extends Schema.TaggedError<ServerLockHeld>()('ServerLockHeld', { message: Schema.String }) {}
const Identity = Schema.Struct({ device: Schema.String.check(Schema.isPattern(/^\d+$/u)), inode: Schema.String.check(Schema.isPattern(/^\d+$/u)) });
export type ServerLockIdentity = typeof Identity.Type;
export interface ServerLockHandle {
  readonly identity: ServerLockIdentity;
  readonly verify: Effect.Effect<void, ServerLockUnavailable>;
  readonly close: Effect.Effect<void>;
}
const NativeIdentity = Schema.Struct({ revision: Schema.Literal(HAWDB_REVISION), abi: Schema.Literal(HAWDB_ABI) });
let binding: ServerLockBinding | undefined;
function load(): ServerLockBinding {
  if (binding) return binding;
  if (sourceInstallation) verifySourceNativeArtifact();
  const target = hawdbTarget(), directory = join(nativeArtifactRoot, target);
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(directory, 'artifact.json'), 'utf8')));
  const binary = join(directory, 'hawdb.node');
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  if (artifact.target !== target || artifact.binarySha256 !== hash(binary) || artifact.noticesSha256 !== hash(join(directory, 'THIRD-PARTY-NOTICES.txt'))) {
    throw new Error('Native server lock artifact digest differs');
  }
  const loaded = createRequire(import.meta.url)(binary) as ServerLockBinding;
  Schema.decodeUnknownSync(NativeIdentity, { onExcessProperty: 'error' })(loaded.nativeIdentity());
  if (typeof loaded.ServerLock !== 'function') throw new Error('Native artifact has no server lock binding');
  binding = loaded;
  return loaded;
}
const nativeReasons = { ServerLockPermission: 'permission', ServerLockIo: 'io', ServerLockType: 'type', ServerLockIdentity: 'identity', ServerLockClosed: 'closed' } as const;
function failure(cause: unknown): ServerLockUnavailable | ServerLockHeld {
  const message = cause instanceof Error ? cause.message : String(cause);
  const prefix = message.split(':', 1)[0]!;
  if (prefix === 'ServerLockBusy') return new ServerLockHeld({ message });
  const reason = Object.hasOwn(nativeReasons, prefix) ? nativeReasons[prefix as keyof typeof nativeReasons] : 'native';
  return new ServerLockUnavailable({ reason, message });
}
/** The caller creates the canonical server directory before admission. */
export const acquireServerLock = Effect.fn('acquireServerLock')(function*(serverDirectory: string) {
  return yield* Effect.try({
    try: (): ServerLockHandle => {
      const directory = Schema.decodeUnknownSync(Schema.String)(serverDirectory);
      const native: NativeServerLock = new (load().ServerLock)(directory);
      try {
        const identity = Schema.decodeUnknownSync(Identity, { onExcessProperty: 'error' })(native.identity());
        return {
          identity,
          verify: Effect.try({ try: () => native.verify(), catch: cause => {
            const error = failure(cause);
            return error._tag === 'ServerLockHeld' ? new ServerLockUnavailable({ reason: 'native', message: error.message }) : error;
          } }),
          close: Effect.sync(() => native.close()),
        };
      } catch (cause) { native.close(); throw cause; }
    },
    catch: failure,
  });
});
/** Scoped callers cannot leak the OS lock on failure, interruption or exit. */
export const scopedServerLock = (serverDirectory: string) => Effect.acquireRelease(acquireServerLock(serverDirectory), handle => handle.close);
