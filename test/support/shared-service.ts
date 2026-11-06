// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#共享服务
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Schema, Scope } from 'effect';
import { connectWorkspaceSocket, type WorkspaceConnection } from '../../src/entry/server/index.ts';
import type { WorkspaceProjection } from '../../src/model/index.ts';
import { acquireBrowserSharedFixture, FrozenBrowserRepository, type BrowserSharedFixture } from './browser-shared-fixture.ts';
import { beforeConsumerCleanup, createConsumer, retainConsumer } from './consumer.ts';
import { fetchFresh, parseWorkspaceProjection, pollUntil, writeProjectConfig } from './support.ts';

const Instance = Schema.Struct({ pid: Schema.Int, token: Schema.String, installation: Schema.String, socket: Schema.Struct({ path: Schema.String }) });
const Jobs = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Array(Schema.Unknown) });
export interface SharedResponse { readonly status: number; readonly type: string | undefined; readonly body: string; readonly headers: Headers }

/** A case owns its requests and RPC scopes; restoration never races their release. */
export class SharedWorkspace {
  private readonly pending = new Set<Promise<unknown>>();
  private controller: AbortController | undefined;
  private frozenSourceDigest: string | undefined;
  private stopped = false;
  private readonly fixture: BrowserSharedFixture;
  private readonly release: () => Promise<void>;
  constructor(fixture: BrowserSharedFixture, release: () => Promise<void>) { this.fixture = fixture; this.release = release; }
  get closed() { return this.stopped; }
  get root() { return this.fixture.root; }
  get address() { return this.fixture.server.address; }
  get port() { return this.fixture.server.port; }
  get pid() { return this.fixture.server.process.pid; }
  get instance() { return Schema.decodeUnknownSync(Schema.fromJsonString(Instance), { onExcessProperty: 'ignore' })(readFileSync(join(this.root, '.git/concord/server/current.json'), 'utf8')); }

  private track<A>(operation: () => Promise<A>): Promise<A> {
    if (this.controller === undefined) return Promise.reject(new Error('Shared workspace requests require an active serial case'));
    const task = operation();
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<SharedResponse> {
    const signal = this.controller?.signal;
    const response = await fetchFresh(new URL(path, this.address), {
      ...options, signal: signal ? AbortSignal.any([signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(10_000)]) : options.signal ?? AbortSignal.timeout(10_000),
    });
    // Consume bytes before releasing the connection's ownership to the next case.
    const body = await response.text();
    return { status: response.status, type: response.headers.get('content-type') ?? undefined, body, headers: response.headers };
  }

  http(path: string, options: RequestInit = {}): Promise<SharedResponse> { return this.track(() => this.fetch(path, options)); }

  connection<A, E>(operation: (connection: WorkspaceConnection) => Effect.Effect<A, E, Scope.Scope>): Promise<A> {
    const workspace = this;
    return this.track(() => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const instance = yield* Effect.sync(() => workspace.instance);
      const connection = yield* connectWorkspaceSocket(instance.socket.path, instance.installation, instance.token);
      return yield* operation(connection);
    })), { signal: this.controller!.signal }));
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      const outcomes = await Promise.allSettled([...this.pending]);
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, 'Shared workspace requests did not finish cleanly');
    }
  }

  private async projection(): Promise<WorkspaceProjection> {
    return pollUntil(async () => {
      const response = await this.fetch('/api/workspace');
      const value = response.status === 200 ? parseWorkspaceProjection(response.body) : undefined;
      return value?.projection.complete && value.projection.changedPaths.length === 0 && value.snapshot.complete ? value : undefined;
    }, { description: 'complete and consistent shared workspace projection', timeoutMs: 65_000 });
  }

  /** A new explicit refresh must finish after this request. */
  ready(): Promise<WorkspaceProjection> {
    return this.track(async () => { await this.fixture.ready(this.controller?.signal); return this.projection(); });
  }

  async restore(): Promise<void> {
    await this.drain();
    const jobs = await this.fetch('/api/jobs');
    const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(Jobs), { onExcessProperty: 'error' })(jobs.body);
    if (decoded.value.length !== 0) throw new Error('Cases with jobs or subscriptions require a private workspace');
    await this.fixture.restore(this.controller?.signal);
    const current = await this.projection();
    this.frozenSourceDigest ??= current.projection.sourceDigest;
    if (current.projection.sourceDigest !== this.frozenSourceDigest) throw new Error('Shared workspace restoration changed its frozen source digest');
  }

  async run<A>(operation: (workspace: SharedWorkspace) => Promise<A>, signal?: AbortSignal): Promise<A> {
    if (this.stopped) throw new Error('Shared workspace is closed');
    if (this.controller !== undefined) throw new Error('Shared workspace cases must run serially');
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      controller.signal.throwIfAborted();
      await this.restore();
      const value = await operation(this);
      await this.drain();
      controller.signal.throwIfAborted();
      return value;
    } catch (cause) {
      controller.abort(cause);
      this.stopped = true;
      const requests = await Promise.allSettled([this.drain()]);
      const cleanup = [...requests, ...await Promise.allSettled([this.release()])];
      const failures = cleanup.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
      if (failures.length > 0) throw new AggregateError([cause, ...failures], 'Shared workspace case and resource cleanup failed');
      throw cause;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controller = undefined;
    }
  }

  async stopRequests(): Promise<void> { this.controller?.abort(); await this.drain(); }
}

export const acquireSharedWorkspace = Effect.fn('test.acquireSharedWorkspace')(function*(signal?: AbortSignal) {
  let root: string | undefined;
  const close = (scope: Scope.Closeable) => Scope.close(scope, Exit.void).pipe(Effect.onExit(exit =>
    Exit.isFailure(exit) && root !== undefined ? Effect.sync(() => retainConsumer(root!)) : Effect.void));
  const scope = yield* Effect.acquireRelease(Scope.make(), close);
  const fixture = yield* acquireBrowserSharedFixture(signal, () => {
    const directory = createConsumer();
    root = directory;
    try { writeProjectConfig(directory, { testRoots: [] }); return new FrozenBrowserRepository(directory); }
    catch (cause) { rmSync(directory, { recursive: true, force: true }); throw cause; }
  }).pipe(Scope.provide(scope));
  const workspace = new SharedWorkspace(fixture, () => Effect.runPromise(close(scope)));
  yield* Effect.addFinalizer(() => Effect.tryPromise(() => workspace.stopRequests()).pipe(Effect.orDie));
  return workspace;
});

let current: Promise<{ readonly workspace: SharedWorkspace; readonly scope: Scope.Closeable }> | undefined;
export async function closeSharedWorkspace(): Promise<void> {
  const owned = current;
  if (!owned) return;
  const { scope } = await owned;
  try { await Effect.runPromise(Scope.close(scope, Exit.void)); }
  finally { current = undefined; }
}

/** Official Node isolation gives each file one lazily acquired consumer and service. */
export async function sharedWorkspace(): Promise<SharedWorkspace> {
  if (current !== undefined && (await current).workspace.closed) current = undefined;
  current ??= (async () => {
    const scope = Effect.runSync(Scope.make());
    try { return { workspace: await Effect.runPromise(acquireSharedWorkspace().pipe(Scope.provide(scope))), scope }; }
    catch (cause) {
      try { await Effect.runPromise(Scope.close(scope, Exit.void)); }
      catch (cleanup) { throw new AggregateError([cause, cleanup], 'Shared workspace startup and cleanup failed'); }
      current = undefined;
      throw cause;
    }
  })();
  return (await current).workspace;
}
beforeConsumerCleanup(closeSharedWorkspace);
