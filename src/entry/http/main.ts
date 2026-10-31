import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive, openWriteRepository } from "../../app/index.js";
import { Git } from '../../base/git/index.js';
import { OwnedProcessLive } from '../../base/process/index.js';
import { Workspace } from '../../base/workspace/index.js';
import { Sources } from '../../base/sources/index.js';
import { NodeServices } from '@effect/platform-node';
import { Cache, CacheSnapshot } from '../../base/cache/index.js';

const publication = Publication.layer.pipe(Layer.provide(PublicationValidationLive));
export const httpOperationLayer = Layer.mergeAll(Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(), publication).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
export const runOperation = <A, E>(operation: Effect.Effect<A, E, Publication | Workspace | Sources | Git>, options?: { readonly signal?: AbortSignal }) =>
  Effect.runPromise(operation.pipe(Effect.provide(httpOperationLayer)), options);

export const withHttpWriter = <A>(root: string, use: (repo: import('../../app/index.js').LocalRepository) => Promise<A>) =>
  runOperation(Effect.scoped(Effect.flatMap(openWriteRepository(root), repo => Effect.tryPromise({ try: () => use(repo), catch: cause => cause }))));
