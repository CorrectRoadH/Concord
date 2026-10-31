import { Installation } from '../../src/base/installation/index.js';
import { NodeServices } from '@effect/platform-node';
import { Workspace } from '../../src/base/workspace/index.js';
import { Sources } from '../../src/base/sources/index.js';
import { Effect, Layer } from 'effect';
import { LocalRepository as RepositoryBase, type RepositoryOptions } from '../../src/base/workspace/index.js';
import { Publication } from '../../src/base/publication/index.js';
import { PublicationValidationLive } from '../../src/app/index.js';
import { Git } from '../../src/base/git/index.js';
import { OwnedProcessLive, type OwnedProcess } from '../../src/base/process/index.js';

export const publicationLayer = Publication.layer.pipe(Layer.provide(PublicationValidationLive));
export const withPublication = <A, E, R>(operation: Effect.Effect<A, E, R | Publication>): Effect.Effect<A, E, Exclude<R, Publication>> =>
  operation.pipe(Effect.provide(publicationLayer));

/** Test composition root: real validation and the real workspace implementation. */
export class LocalRepository extends RepositoryBase {
  constructor(root?: string, options: RepositoryOptions = {}) {
    const publication = Effect.runSync(Effect.gen(function*() { return yield* Publication; }).pipe(Effect.provide(publicationLayer)));
    super(root, options, publication.validation);
  }
}
export const runApplication = <A, E>(operation: Effect.Effect<A, E, Publication | Installation | Workspace | Sources | Git | OwnedProcess | NodeServices.NodeServices>, options?: Parameters<typeof Effect.runPromise>[1]) => Effect.runPromise(operation.pipe(Effect.provide(publicationLayer), Effect.provide(Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Git.layer)), Effect.provide(OwnedProcessLive), Effect.provide(NodeServices.layer)), options);
export const publicationService = () => Effect.runSync(Effect.gen(function*() { return yield* Publication; }).pipe(Effect.provide(publicationLayer)));
export { initialize } from './operations.js';
