import { Effect } from "effect";
import type { ReadRepositoryOptions, RepositoryOptions } from './storage.ts';
import { Workspace } from './service.ts';

export const openReadRepository = Effect.fn('Workspace.openRead')(function*(root: string | undefined, options: ReadRepositoryOptions) {
  return yield* (yield* Workspace).openRead(root, options);
});
export const openWriteRepository = Effect.fn('Workspace.openWrite')(function*(root: string | undefined, options: RepositoryOptions = {}) {
  return yield* (yield* Workspace).openWrite(root, options);
});
