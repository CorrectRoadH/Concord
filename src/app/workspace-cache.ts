// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#清理
import { Effect } from 'effect';
import { Workspace } from '../base/workspace/index.js';
import { waitForPublication } from '../base/publication/index.js';
import { clearCache } from '../domain/tests/index.js';
import { failure } from '../model/index.js';

export const clearWorkspaceCache = Effect.fn('clearWorkspaceCache')(function*(root: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const workspace = yield* Workspace;
    const repo = yield* waitForPublication(reclaimPublication => workspace.openWrite(root, { optimistic: false, persistentCache: 'off', reclaimPublication }));
    return yield* Effect.try({ try: () => repo.snapshot(() => clearCache(repo)), catch: failure });
  }));
});
