import { PersistentCache } from '../../src/base/cache/index.ts';
import { Installation } from '../../src/base/installation/index.ts';
import { NodeServices } from '@effect/platform-node';
import { Workspace } from '../../src/base/workspace/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { Effect, Exit, Layer, Scope } from 'effect';
import { LocalRepository as RepositoryBase, type RepositoryOptions } from '../../src/base/workspace/index.ts';
import { Publication } from '../../src/base/publication/index.ts';
import { PublicationValidationLive } from '../../src/app/index.ts';
import { Git } from '../../src/base/git/index.ts';
import { OwnedProcessLive, type OwnedProcess } from '../../src/base/process/index.ts';

export const publicationLayer = Publication.layer.pipe(Layer.provide(PublicationValidationLive));
export const withPublication = <A, E, R>(operation: Effect.Effect<A, E, R | Publication>): Effect.Effect<A, E, Exclude<R, Publication>> =>
  operation.pipe(Effect.provide(publicationLayer));

/** Test composition root: real validation and the real workspace implementation. */
export class LocalRepository extends RepositoryBase {
  private cacheScope?: Scope.Scope;
  constructor(root?: string, options: RepositoryOptions = {}) {
    const publication = Effect.runSync(Effect.gen(function*() { return yield* Publication; }).pipe(Effect.provide(publicationLayer)));
    super(root, options, publication.validation);
    this.cacheScope = Effect.runSync(Scope.make());
    Effect.runSync(Effect.flatMap(PersistentCache, cache => cache.attach(this)).pipe(Scope.provide(this.cacheScope), Effect.provide(PersistentCache.layer)));
  }
  override close(): void {
    super.close();
    if (this.cacheScope !== undefined) {
      const scope = this.cacheScope; this.cacheScope = undefined; Effect.runSync(Scope.close(scope, Exit.void));
    }
  }
}
export const runApplication = <A, E>(operation: Effect.Effect<A, E, Publication | PersistentCache | Installation | Workspace | Sources | Git | OwnedProcess | NodeServices.NodeServices>, options?: Parameters<typeof Effect.runPromise>[1]) => Effect.runPromise(operation.pipe(Effect.provide(publicationLayer), Effect.provide(Layer.mergeAll(PersistentCache.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer)), Effect.provide(OwnedProcessLive), Effect.provide(NodeServices.layer)), options);
export const publicationService = () => Effect.runSync(Effect.gen(function*() { return yield* Publication; }).pipe(Effect.provide(publicationLayer)));
export { initialize } from './operations.ts';
