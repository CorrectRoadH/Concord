import { Context, Effect, Layer, Option, Path, type Scope } from 'effect';
import { CacheSnapshot, PersistentCache } from '../cache/index.js';
import { failure, type ConcordError } from '../../model/index.js';
import { Publication } from '../publication/index.js';
import { LocalRepository, type ReadRepositoryOptions, type RepositoryOptions } from './storage.js';
import { inspectConfiguration, identifyWorkspace } from './config-inspection.js';

const attachCache = Effect.fn('Workspace.attachCache')(function*(repo: LocalRepository) {
  const persistent = yield* Effect.serviceOption(PersistentCache);
  if (Option.isSome(persistent)) return yield* persistent.value.attach(repo).pipe(Effect.mapError(failure));
  const snapshot = yield* Effect.serviceOption(CacheSnapshot);
  if (Option.isSome(snapshot)) yield* snapshot.value.attach(repo).pipe(Effect.mapError(failure));
});

export interface WorkspaceService {
  readonly identify: typeof identifyWorkspace;
  readonly inspectConfiguration: typeof inspectConfiguration;
  readonly openRead: (root: string | undefined, options: ReadRepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Scope.Scope>;
  readonly openWrite: (root: string | undefined, options?: RepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Publication | Scope.Scope>;
}

/** A repository and its configuration are operation scoped, never layer scoped. */
export class Workspace extends Context.Service<Workspace, WorkspaceService>()('concord/base/workspace/Workspace') {
  static readonly layer = Layer.effect(Workspace, Effect.gen(function*() {
    const path = yield* Path.Path;
    const openRead = Effect.fn('Workspace.openRead')(function*(root: string | undefined, options: ReadRepositoryOptions) {
      const repo = yield* Effect.acquireRelease(
        Effect.try({ try: () => new LocalRepository(root === undefined ? root : path.resolve(root), options), catch: failure }),
        repo => Effect.sync(() => repo.close()),
      );
      yield* attachCache(repo);
      return repo;
    });
    const openWrite = Effect.fn('Workspace.openWrite')(function*(root: string | undefined, options: RepositoryOptions = {}) {
      const publication = yield* Publication;
      const repo = yield* Effect.acquireRelease(
        Effect.try({ try: () => new LocalRepository(root === undefined ? root : path.resolve(root), options, publication.validation), catch: failure }),
        repo => Effect.sync(() => repo.close()),
      );
      yield* attachCache(repo);
      return repo;
    });
    return Workspace.of({ openRead, openWrite, inspectConfiguration, identify: identifyWorkspace });
  }));
}
