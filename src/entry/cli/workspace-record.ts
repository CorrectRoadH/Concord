// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { Effect } from 'effect';
import type { ServerRuntime } from '../../base/server-lock/index.ts';
import { failure } from '../../model/index.ts';

export const readWorkspaceRecord = Effect.fn('cli.readWorkspaceRecord')(function*(runtime: ServerRuntime['Service'], privateDir: string, requireSocket = true) {
  const read = yield* Effect.result(Effect.try({ try: () => runtime.read(privateDir, requireSocket), catch: failure }));
  if (read._tag === 'Success') return read.success;
  // Reboot or remount can invalidate a dead owner's device/socket identity.
  // Only the actual native lock can establish absence; the next server still
  // acquires that lock before replacing the record or touching its socket.
  if (read.failure.code === 'WorkspaceServerUnavailable' && (yield* runtime.released(privateDir))) return undefined;
  return yield* Effect.fail(read.failure);
});
