import { Context, Effect, FileSystem, Layer, Path, Stdio, Stream } from 'effect';
import { failure, ConcordError } from '../../model/index.js';
import { waitForPublication } from '../publication/index.js';
import { readRepositoryFileSync, type LocalRepository } from '../workspace/index.js';

export interface SourcesService {
  readonly read: (root: string, path: string) => Effect.Effect<string | undefined, ConcordError>;
  readonly authorBody: (path: string) => Effect.Effect<string, ConcordError>;
  readonly snapshot: <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ConcordError, R>;
}

/** Observations belong to one operation, including its return-time verification. */
export class Sources extends Context.Service<Sources, SourcesService>()('concord/base/sources/Sources') {
  static readonly layer = Layer.effect(Sources, Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stdio = yield* Stdio.Stdio;
    return Sources.of({
      read: Effect.fn('Sources.read')((root: string, relative: string) => Effect.try({ try: () => readRepositoryFileSync(path.resolve(root), relative), catch: failure })),
      authorBody: Effect.fn('Sources.authorBody')(function*(path: string) {
        if (path !== '-') {
          const source = yield* fs.readFileString(path).pipe(Effect.mapError(failure));
          if (Buffer.byteLength(source) > 4 * 1024 * 1024) return yield* Effect.fail(new ConcordError('InvalidBody', 'Author content exceeds 4 MiB'));
          return source;
        }
        const chunks: Uint8Array[] = [];
        yield* Stream.runFoldEffect(stdio.stdin, () => 0, (size, chunk) => {
          const next = size + chunk.byteLength;
          if (next > 4 * 1024 * 1024) return Effect.fail(new ConcordError('InvalidBody', 'Author content exceeds 4 MiB'));
          chunks.push(chunk);
          return Effect.succeed(next);
        }).pipe(Effect.mapError(failure));
        return Buffer.concat(chunks).toString('utf8');
      }),
      snapshot: <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.acquireUseRelease(
        waitForPublication(reclaimDead => Effect.try({ try: () => repo.beginSnapshot(reclaimDead), catch: failure })),
        () => operation.pipe(Effect.tap(() => Effect.try({ try: () => repo.verifySnapshot(), catch: failure }))),
        () => Effect.sync(() => repo.endSnapshot()),
      ),
    });
  }));
}
