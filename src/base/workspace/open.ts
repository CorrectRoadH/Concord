import { Effect } from "effect";
import { Publication } from "../publication/index.js";
import { failure } from "../../model/index.js";
import { LocalRepository, type ReadRepositoryOptions, type RepositoryOptions } from "./storage.js";

export const openReadRepository = Effect.fn('Workspace.openRead')(function*(root: string | undefined, options: ReadRepositoryOptions) {
  return yield* Effect.try({ try: () => new LocalRepository(root, options), catch: failure });
});
export const openWriteRepository = Effect.fn('Workspace.openWrite')(function*(root: string | undefined, options: RepositoryOptions = {}) {
  const publication = yield* Publication;
  return yield* Effect.try({ try: () => new LocalRepository(root, options, publication.validation), catch: failure });
});
