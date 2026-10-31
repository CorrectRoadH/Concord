import { Context, Effect, Layer, Path, type Scope } from 'effect';
import { failure, type ConcordError } from '../../model/index.js';
import { Publication } from '../publication/index.js';
import { LocalRepository, type ReadRepositoryOptions, type RepositoryOptions } from './storage.js';

export interface WorkspaceService {
  readonly openRead: (root: string | undefined, options: ReadRepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Scope.Scope>;
  readonly openWrite: (root: string | undefined, options?: RepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Publication | Scope.Scope>;
}

/** A repository and its configuration are operation scoped, never layer scoped. */
export class Workspace extends Context.Service<Workspace, WorkspaceService>()('concord/base/workspace/Workspace') {
  static readonly layer = Layer.effect(Workspace, Effect.gen(function*() {
    const path = yield* Path.Path;
    const openRead = Effect.fn('Workspace.openRead')(function*(root: string | undefined, options: ReadRepositoryOptions) {
      return yield* Effect.acquireRelease(
        Effect.try({ try: () => new LocalRepository(root === undefined ? root : path.resolve(root), options), catch: failure }),
        repo => Effect.sync(() => repo.close()),
      );
    });
    const openWrite = Effect.fn('Workspace.openWrite')(function*(root: string | undefined, options: RepositoryOptions = {}) {
      const publication = yield* Publication;
      return yield* Effect.acquireRelease(
        Effect.try({ try: () => new LocalRepository(root === undefined ? root : path.resolve(root), options, publication.validation), catch: failure }),
        repo => Effect.sync(() => repo.close()),
      );
    });
    return Workspace.of({ openRead, openWrite });
  }));
}
