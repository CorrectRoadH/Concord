import { RuntimeEnvironment, runtimePath, runtimeTemporaryDirectory } from '../environment/index.ts';
import { Context, Effect, FileSystem, Layer, Path, Result, Stdio, Stream, type Scope } from 'effect';
import { failure, ConcordError } from '../../model/index.ts';
import { inspectPendingJournals, waitForPublication } from '../publication/index.ts';
import { readRepositoryBytesSync, readRepositoryFileSync, WorkspaceContext, LocalRepository, type WorkspaceMetadata } from '../workspace/index.ts';
import { SourceSnapshot } from './source-snapshot.ts';
import { SourcePublication } from './publication-view.ts';
import { withOperationCache } from '../cache/operation-cache.ts';
import { NodeSourceWatch } from './source-watch.ts';
import { readReportFiles } from './report-files.ts';
import { untrackedFile } from './untracked-file.ts';
export type SourceWatch = Pick<NodeSourceWatch, 'reconcile' | 'close'>;
export interface SourceInspection {
  readonly file: boolean;
  readonly directory: boolean;
  readonly symbolicLink: boolean;
  readonly size: number;
  readonly mode: number;
  readonly identity: string;
}

class PublicationViewLease extends Context.Service<PublicationViewLease, object>()('concord/base/sources/PublicationViewLease') {}

export interface SnapshotOperation {
  <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E | ConcordError, WorkspaceContext | Exclude<R, SourceSnapshot | SourcePublication>>;
  <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>): Effect.Effect<A, E | ConcordError, Exclude<R, SourceSnapshot | SourcePublication | WorkspaceContext>>;
}
export interface SourceDrift {
  readonly files: string[];
  readonly directories: string[];
  readonly publicationChanged: boolean;
}
export interface ProjectionOperation {
  <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<{ readonly value: A; readonly drift: SourceDrift }, E | ConcordError, WorkspaceContext | Exclude<R, SourceSnapshot | SourcePublication>>;
  <A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>): Effect.Effect<{ readonly value: A; readonly drift: SourceDrift }, E | ConcordError, Exclude<R, SourceSnapshot | SourcePublication | WorkspaceContext>>;
}

export interface SourcesService {
  readonly createReportDirectory: (path: string) => Effect.Effect<void, ConcordError>;
  readonly readBytesAt: (root: string, path: string) => Effect.Effect<Uint8Array | undefined, ConcordError>;
  readonly readBytes: (path: string) => Effect.Effect<Uint8Array | undefined, ConcordError, SourceSnapshot>;
  readonly untrackedFile: typeof untrackedFile;
  readonly readAt: (root: string, path: string) => Effect.Effect<string | undefined, ConcordError>;
  readonly read: (path: string) => Effect.Effect<string | undefined, ConcordError, SourceSnapshot>;
  readonly files: (prefix: string, scope?: 'source') => Effect.Effect<readonly string[], ConcordError, SourceSnapshot>;
  readonly inspect: (path: string) => Effect.Effect<SourceInspection | undefined, ConcordError, SourceSnapshot>;
  readonly rootFiles: Effect.Effect<readonly string[], ConcordError, SourceSnapshot>;
  readonly authorBody: (path: string) => Effect.Effect<string, ConcordError>;
  readonly watch: (root: string, changed: () => void, failed: (error: ConcordError) => void) => Effect.Effect<SourceWatch, never, Scope.Scope>;
  readonly watchPrivateHead: (privateDir: string, changed: () => void) => Effect.Effect<void, never, Scope.Scope>;
  readonly pendingPublications: typeof inspectPendingJournals;
  readonly readReportFiles: typeof readReportFiles;
  readonly existsAt: (path: string) => Effect.Effect<boolean, ConcordError>;
  readonly exists: (path: string) => Effect.Effect<boolean, ConcordError, SourceSnapshot>;
  readonly directoryEntries: (path: string) => Effect.Effect<readonly string[], ConcordError>;
  readonly temporaryDirectory: (prefix: string, cleanupFailed?: (error: ConcordError) => void) => Effect.Effect<string, ConcordError, Scope.Scope>;
  readonly snapshot: SnapshotOperation;
  readonly observeProjection: ProjectionOperation;
}

/** Observations belong to one operation, including its return-time verification. */
export class Sources extends Context.Service<Sources, SourcesService>()('concord/base/sources/Sources') {
  static readonly layer = Layer.effect(Sources, Effect.gen(function*() {
    const runtime = yield* RuntimeEnvironment;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stdio = yield* Stdio.Stdio;
    interface Session {
      readonly repo: LocalRepository;
      readonly inspections: Map<string, SourceInspection | undefined>;
      sealed: boolean;
      leaseToken: object | undefined;
      verifyLease: (() => void) | undefined;
    }
    const active = new WeakMap<SourceSnapshot['Service'], Session>();
    const assertReadable = (session: Session | undefined): Session => {
      if (session === undefined) throw new ConcordError('OperationFailed', 'Source snapshot is no longer active');
      if (session.sealed) throw new ConcordError('OperationFailed', 'Committed source snapshot is sealed; open a fresh workspace context');
      return session;
    };
    const observed = Effect.fn('Sources.observed')(function*<A>(read: (repo: LocalRepository) => A) {
      const identity = yield* SourceSnapshot;
      return yield* Effect.try({ try: () => {
        const session = assertReadable(active.get(identity));
        return read(session.repo);
      }, catch: failure });
    });
    const inspect = Effect.fn('Sources.inspect')(function*(path: string) {
      const identity = yield* SourceSnapshot;
      return yield* Effect.try({ try: () => {
        const session = assertReadable(active.get(identity));
        const inspected = session.repo.inspect(path);
        const value = inspected === undefined ? undefined : Object.freeze({ ...inspected });
        if (!session.inspections.has(path)) session.inspections.set(path, value);
        return value;
      }, catch: failure });
    });
    const verify = (session: Session) => Effect.try({ try: () => {
      if (session.sealed) return;
      session.repo.verifySnapshot();
      for (const [path, before] of session.inspections) {
        const current = session.repo.inspect(path);
        if (JSON.stringify(current) !== JSON.stringify(before)) throw new ConcordError('SourceChanged', `Source metadata changed during the snapshot: ${path}`, 'source-observation');
      }
    }, catch: failure });
    const runSnapshot = <A, E, R>(repo: LocalRepository, workspace: WorkspaceMetadata, operation: Effect.Effect<A, E, R>, retryLivePublication = false, complete = verify, projection = false) => Effect.gen(function*() {
      const parent = yield* Effect.serviceOption(SourceSnapshot);
      if (projection && parent._tag === 'Some' && active.get(parent.value)?.repo === repo) return yield* Effect.fail(new ConcordError('InvalidProjectionRead', 'Projection observation requires an independent optimistic snapshot'));
      if (parent._tag === 'Some' && active.get(parent.value)?.repo === repo) return yield* operation.pipe(Effect.provideContext(Context.make(SourceSnapshot, parent.value).pipe(Context.add(WorkspaceContext, parent.value.workspace))));
      for (;;) {
        const identity = SourceSnapshot.of({ workspace });
        const session: Session = { repo, inspections: new Map(), sealed: false, leaseToken: undefined, verifyLease: undefined };
        const requireLease = Effect.gen(function*() {
          const token = yield* Effect.serviceOption(PublicationViewLease);
          const current = yield* Effect.serviceOption(SourceSnapshot);
          yield* Effect.try({ try: () => {
            assertReadable(active.get(identity));
            if (current._tag === 'None' || current.value !== identity || token._tag === 'None' || token.value !== session.leaseToken) throw new ConcordError('RepositoryBusy', 'Source publication view requires an owned publication lease');
            session.verifyLease!();
          }, catch: failure });
        });
        const publication = SourcePublication.of({
          withLease: (lease, operation) => Effect.acquireUseRelease(
            Effect.gen(function*() {
              const current = yield* Effect.serviceOption(SourceSnapshot);
              return yield* Effect.try({ try: () => {
                assertReadable(active.get(identity));
                if (current._tag === 'None' || current.value !== identity || projection || session.leaseToken !== undefined) throw new ConcordError('RepositoryBusy', 'Source publication requires an independent current view');
                const binding = repo.bindPublicationLease(lease);
                const token = {};
                session.leaseToken = token;
                session.verifyLease = binding.verify;
                return { release: binding.release, token };
              }, catch: failure });
            }),
            ({ token }) => requireLease.pipe(Effect.andThen(verify(session)), Effect.andThen(operation), Effect.provideService(PublicationViewLease, token)),
            ({ release }) => Effect.sync(() => { session.leaseToken = undefined; session.verifyLease = undefined; release(); }),
          ),
          verify: requireLease.pipe(Effect.andThen(verify(session))),
          seal: requireLease.pipe(Effect.andThen(Effect.sync(() => { session.sealed = true; session.inspections.clear(); }))),
        });
        const run = withOperationCache(workspace, runtime, operation).pipe(Effect.provideContext(Context.make(SourceSnapshot, identity).pipe(Context.add(WorkspaceContext, identity.workspace), Context.add(SourcePublication, publication))));
        const result = yield* Effect.result(Effect.acquireUseRelease(
          projection
            ? Effect.try({ try: () => repo.beginProjection(), catch: failure })
            : waitForPublication(reclaimDead => Effect.try({ try: () => repo.beginSnapshot(reclaimDead), catch: failure })),
          () => Effect.acquireUseRelease(
            Effect.sync(() => { active.set(identity, session); }),
            () => run.pipe(Effect.tap(() => complete(session))),
            () => Effect.sync(() => { active.delete(identity); }),
          ),
          () => Effect.sync(() => repo.endSnapshot()),
        ));
        if (Result.isSuccess(result)) return result.success;
        const error = result.failure;
        // Only a read snapshot may discard observations and evaluate again
        // when a publisher entered after acquisition. Never replay a writer.
        const publishing = error instanceof ConcordError && error.code === 'RepositoryBusy'
          && typeof error.details === 'object' && error.details !== null
          && 'livePublication' in error.details && error.details.livePublication === true;
        if (!retryLivePublication || workspace.access !== 'read' || !publishing) return yield* Effect.fail(error);
        yield* Effect.sleep('50 millis');
      }
    });
    function snapshot<A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E | ConcordError, WorkspaceContext | Exclude<R, SourceSnapshot | SourcePublication>>;
    function snapshot<A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>): Effect.Effect<A, E | ConcordError, Exclude<R, SourceSnapshot | SourcePublication | WorkspaceContext>>;
    function snapshot<A, E, R>(input: LocalRepository | Effect.Effect<A, E, R>, operation?: Effect.Effect<A, E, R>) {
      return capture(input, operation);
    }
    function capture<A, E, R>(input: LocalRepository | Effect.Effect<A, E, R>, operation?: Effect.Effect<A, E, R>, complete = verify, projection = false) {
      if (input instanceof LocalRepository) {
        const workspace: WorkspaceMetadata = Object.freeze({ root: input.root, privateDir: input.privateDir, configuration: input.configSnapshot, config: input.config, access: input.access, cache: input.persistentCache });
        return runSnapshot(input, workspace, operation!, !projection, complete, projection);
      }
      return Effect.gen(function*() {
        const workspace = yield* WorkspaceContext;
        const parent = yield* Effect.serviceOption(SourceSnapshot);
        if (parent._tag === 'Some' && parent.value.workspace === workspace && active.has(parent.value)) {
          if (projection) return yield* Effect.fail(new ConcordError('InvalidProjectionRead', 'Projection observation requires an independent optimistic snapshot'));
          return yield* input.pipe(Effect.provideService(SourceSnapshot, parent.value));
        }
        // The descriptor adapter supplies no publication capability. Every
        // independent operation owns its own reader, even for the same root.
        return yield* Effect.acquireUseRelease(
          waitForPublication(() => Effect.try({ try: () => new LocalRepository(workspace.root, { access: 'read', optimistic: true, persistentCache: 'off', reclaimPublication: false, runtime }), catch: failure })),
          repo => Effect.gen(function*() {
            if (repo.privateDir !== workspace.privateDir || repo.configSnapshot.digest !== workspace.configuration.digest || repo.configSnapshot.source !== workspace.configuration.source) {
              return yield* Effect.fail(new ConcordError('FileChangedSinceRead', 'Project configuration changed; open a fresh workspace context', 'source-observation'));
            }
            return yield* runSnapshot(repo, workspace, input, false, complete, projection);
          }),
          repo => Effect.sync(() => repo.close()),
        );
      });
    }
    function observeProjection<A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<{ readonly value: A; readonly drift: SourceDrift }, E | ConcordError, WorkspaceContext | Exclude<R, SourceSnapshot | SourcePublication>>;
    function observeProjection<A, E, R>(repo: LocalRepository, operation: Effect.Effect<A, E, R>): Effect.Effect<{ readonly value: A; readonly drift: SourceDrift }, E | ConcordError, Exclude<R, SourceSnapshot | SourcePublication | WorkspaceContext>>;
    function observeProjection<A, E, R>(input: LocalRepository | Effect.Effect<A, E, R>, operation?: Effect.Effect<A, E, R>) {
      let drift: SourceDrift = { files: [], directories: [], publicationChanged: false };
      const collect = (session: Session) => Effect.try({ try: () => {
        const observed = session.repo.projectionDrift();
        const files = new Set(observed.files), directories = new Set(observed.directories);
        for (const [path, before] of session.inspections) {
          const current = session.repo.inspect(path);
          if (JSON.stringify(current) !== JSON.stringify(before)) (before?.directory || current?.directory ? directories : files).add(path);
        }
        drift = { files: [...files].sort(), directories: [...directories].sort(), publicationChanged: observed.publicationChanged };
      }, catch: failure });
      return capture(input, operation, collect, true).pipe(Effect.map(value => ({ value, drift })));
    }
    return Sources.of({
      untrackedFile: (root, relative, limit) => untrackedFile(runtimePath(runtime, root), relative, limit),
      createReportDirectory: path => fs.makeDirectory(runtimePath(runtime, path), { mode: 0o700 }).pipe(Effect.mapError(failure)),
      readBytesAt: (root, relative) => Effect.try({ try: () => readRepositoryBytesSync(runtimePath(runtime, root), relative, runtime), catch: failure }),
      readBytes: path => observed(repo => repo.readBytes(path)),
      read: path => observed(repo => repo.read(path)),
      files: (prefix, scope) => observed(repo => repo.files(prefix, scope)),
      inspect,
      rootFiles: observed(repo => repo.rootFiles()),
      temporaryDirectory: Effect.fn('Sources.temporaryDirectory')((prefix: string, cleanupFailed?: (error: ConcordError) => void) => Effect.acquireRelease(
        fs.makeTempDirectory({ prefix, directory: runtimeTemporaryDirectory(runtime) }).pipe(Effect.mapError(failure)),
        directory => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.catch(cause => cleanupFailed === undefined ? Effect.die(failure(cause)) : Effect.sync(() => cleanupFailed(failure(cause))))),
      )),
      pendingPublications: (privateDir, verifyPaths) => inspectPendingJournals(runtimePath(runtime, privateDir), verifyPaths),
      readReportFiles: (directory, declared, limits, budget, validateText) => readReportFiles(runtimePath(runtime, directory), declared, limits, budget, validateText),
      existsAt: path => fs.exists(runtimePath(runtime, path)).pipe(Effect.mapError(failure)),
      exists: path => inspect(path).pipe(Effect.map(value => value !== undefined)),
      directoryEntries: path => fs.readDirectory(runtimePath(runtime, path)).pipe(Effect.mapError(failure)),
      watch: Effect.fn('Sources.watch')((root: string, changed: () => void, failed: (error: ConcordError) => void) => Effect.acquireRelease(
        Effect.sync(() => new NodeSourceWatch(runtimePath(runtime, root), changed, failed)),
        watcher => Effect.sync(() => watcher.close()),
      )),
      watchPrivateHead: (privateDir, changed) => Effect.forkScoped(Stream.runForEach(fs.watch(path.dirname(runtimePath(runtime, privateDir))), event => Effect.sync(() => { if (path.basename(event.path) === 'HEAD') changed(); })).pipe(Effect.ignore)).pipe(Effect.asVoid),
      readAt: Effect.fn('Sources.readAt')((root: string, relative: string) => Effect.try({ try: () => readRepositoryFileSync(runtimePath(runtime, root), relative), catch: failure })),
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
      snapshot,
      observeProjection,
    });
  }));
}
