import { Context, Effect, FileSystem, Layer, Path } from 'effect';
import { failure, type ConcordError } from '../../model/index.js';
import { waitForPublication } from '../publication/index.js';
import { readRepositoryFileSync, type LocalRepository } from '../workspace/index.js';

export interface SourcesService {
  readonly read: (root: string, path: string) => Effect.Effect<string | undefined, ConcordError>;
  readonly snapshot: <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ConcordError, R>;
}

/** Observations belong to one operation, including its return-time verification. */
export class Sources extends Context.Service<Sources, SourcesService>()('concord/base/sources/Sources') {
  static readonly layer = Layer.effect(Sources, Effect.gen(function*() {
    yield* FileSystem.FileSystem;
    yield* Path.Path;
    return Sources.of({
      read: Effect.fn('Sources.read')((root: string, path: string) => Effect.try({ try: () => readRepositoryFileSync(root, path), catch: failure })),
      snapshot: <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.acquireUseRelease(
        waitForPublication(reclaimDead => Effect.try({ try: () => repo.beginSnapshot(reclaimDead), catch: failure })),
        () => operation.pipe(Effect.tap(() => Effect.try({ try: () => repo.verifySnapshot(), catch: failure }))),
        () => Effect.sync(() => repo.endSnapshot()),
      ),
    });
  }));
}
