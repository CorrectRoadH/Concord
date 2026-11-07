import { RuntimeEnvironment, runtimePath, runtimeTemporaryDirectory } from '../environment/index.ts';
import { Context, Effect, FileSystem, Layer, Path, Result, Stdio, Stream, type Scope } from 'effect';
import { failure, ConcordError } from '../../model/index.ts';
import { inspectPendingJournals, waitForPublication } from '../publication/index.ts';
import { readRepositoryBytesSync, readRepositoryFileSync, type LocalRepository } from '../workspace/index.ts';
import { NodeSourceWatch } from './source-watch.ts';
import { readReportFiles } from './report-files.ts';
import { untrackedFile } from './untracked-file.ts';
export type SourceWatch = Pick<NodeSourceWatch, 'reconcile' | 'close'>;

export interface SourcesService {
  readonly createReportDirectory: (path: string) => Effect.Effect<void, ConcordError>;
  readonly readBytes: (root: string, path: string) => Effect.Effect<Uint8Array | undefined, ConcordError>;
  readonly untrackedFile: typeof untrackedFile;
  readonly read: (root: string, path: string) => Effect.Effect<string | undefined, ConcordError>;
  readonly authorBody: (path: string) => Effect.Effect<string, ConcordError>;
  readonly watch: (root: string, changed: () => void, failed: (error: ConcordError) => void) => Effect.Effect<SourceWatch, never, Scope.Scope>;
  readonly watchPrivateHead: (privateDir: string, changed: () => void) => Effect.Effect<void, never, Scope.Scope>;
  readonly pendingPublications: typeof inspectPendingJournals;
  readonly readReportFiles: typeof readReportFiles;
  readonly exists: (path: string) => Effect.Effect<boolean, ConcordError>;
  readonly directoryEntries: (path: string) => Effect.Effect<readonly string[], ConcordError>;
  readonly temporaryDirectory: (prefix: string, cleanupFailed?: (error: ConcordError) => void) => Effect.Effect<string, ConcordError, Scope.Scope>;
  readonly snapshot: <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ConcordError, R>;
}

/** Observations belong to one operation, including its return-time verification. */
export class Sources extends Context.Service<Sources, SourcesService>()('concord/base/sources/Sources') {
  static readonly layer = Layer.effect(Sources, Effect.gen(function*() {
    const runtime = yield* RuntimeEnvironment;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stdio = yield* Stdio.Stdio;
    return Sources.of({
      untrackedFile: (root, relative, limit) => untrackedFile(runtimePath(runtime, root), relative, limit),
      createReportDirectory: path => fs.makeDirectory(runtimePath(runtime, path), { mode: 0o700 }).pipe(Effect.mapError(failure)),
      readBytes: (root, relative) => Effect.try({ try: () => readRepositoryBytesSync(runtimePath(runtime, root), relative, runtime), catch: failure }),
      temporaryDirectory: Effect.fn('Sources.temporaryDirectory')((prefix: string, cleanupFailed?: (error: ConcordError) => void) => Effect.acquireRelease(
        fs.makeTempDirectory({ prefix, directory: runtimeTemporaryDirectory(runtime) }).pipe(Effect.mapError(failure)),
        directory => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.catch(cause => cleanupFailed === undefined ? Effect.die(failure(cause)) : Effect.sync(() => cleanupFailed(failure(cause))))),
      )),
      pendingPublications: (privateDir, verifyPaths) => inspectPendingJournals(runtimePath(runtime, privateDir), verifyPaths),
      readReportFiles: (directory, declared, limits, budget, validateText) => readReportFiles(runtimePath(runtime, directory), declared, limits, budget, validateText),
      exists: path => fs.exists(runtimePath(runtime, path)).pipe(Effect.mapError(failure)),
      directoryEntries: path => fs.readDirectory(runtimePath(runtime, path)).pipe(Effect.mapError(failure)),
      watch: Effect.fn('Sources.watch')((root: string, changed: () => void, failed: (error: ConcordError) => void) => Effect.acquireRelease(
        Effect.sync(() => new NodeSourceWatch(runtimePath(runtime, root), changed, failed)),
        watcher => Effect.sync(() => watcher.close()),
      )),
      watchPrivateHead: (privateDir, changed) => Effect.forkScoped(Stream.runForEach(fs.watch(path.dirname(runtimePath(runtime, privateDir))), event => Effect.sync(() => { if (path.basename(event.path) === 'HEAD') changed(); })).pipe(Effect.ignore)).pipe(Effect.asVoid),
      read: Effect.fn('Sources.read')((root: string, relative: string) => Effect.try({ try: () => readRepositoryFileSync(runtimePath(runtime, root), relative), catch: failure })),
      authorBody: Effect.fn('Sources.authorBody')(function*(path: string) {
        if (path !== '-') {
          const source = yield* fs.readFileString(runtimePath(runtime, path)).pipe(Effect.mapError(failure));
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
      snapshot: <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>) => Effect.gen(function*() {
        for (;;) {
          const result = yield* Effect.result(Effect.acquireUseRelease(
            waitForPublication(reclaimDead => Effect.try({ try: () => repo.beginSnapshot(reclaimDead), catch: failure })),
            () => operation.pipe(Effect.tap(() => Effect.try({ try: () => repo.verifySnapshot(), catch: failure }))),
            () => Effect.sync(() => repo.endSnapshot()),
          ));
          if (Result.isSuccess(result)) return result.success;
          const error = result.failure;
          // Only a read snapshot may discard observations and evaluate again
          // when a publisher entered after acquisition. Never replay a writer.
          const publishing = error instanceof ConcordError && error.code === 'RepositoryBusy'
            && typeof error.details === 'object' && error.details !== null
            && 'livePublication' in error.details && error.details.livePublication === true;
          if (repo.access !== 'read' || !publishing) return yield* Effect.fail(error);
          yield* Effect.sleep('50 millis');
        }
      }),
    });
  }));
}
