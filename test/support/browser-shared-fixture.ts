// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#浏览器与诊断
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Effect, Exit, Scope } from 'effect';
import { startViewServer, ViewServerStartupFailed, type ViewServerHandle, type ViewServerOptions } from '../e2e/server.ts';
import { sourceCli } from './source-consumer.ts';
import { initialize } from './operations.ts';
import { LocalRepository } from './repository.ts';
import { fetchFresh, parseWorkspaceProjection, pollUntil } from './support.ts';
import { tmpdir } from './temporary.ts';
import { stopWorkspaceServer } from './stop-workspace-server.ts';
import { recordBrowserTiming } from '../../scripts/gate-timings.ts';

/** Files are recovered from an immutable Git tree; .git and live handles stay owned by the worker. */
export class FrozenBrowserRepository {
  readonly root: string;
  readonly commit: string;
  private readonly files = new Map<string, Buffer>();
  private readonly directories = new Set<string>();

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'concord-browser-worker-'));
    try {
      this.git(['init', '-q']);
      const repo = new LocalRepository(this.root, { initialize: true });
      try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
      const captureDirectories = (directory: string, prefix = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if ((!prefix && entry.name === '.git') || !entry.isDirectory()) continue;
          const path = prefix ? join(prefix, entry.name) : entry.name;
          this.directories.add(path);
          captureDirectories(join(directory, entry.name), path);
        }
      };
      captureDirectories(this.root);
      this.git(['add', '--all']);
      this.git(['-c', 'user.name=Concord fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Browser fixture']);
      this.commit = this.git(['rev-parse', 'HEAD']).toString().trim();
      for (const record of this.git(['ls-tree', '-rz', this.commit]).toString().split('\0').filter(Boolean)) {
        const tab = record.indexOf('\t');
        const [mode, kind, object] = record.slice(0, tab).split(' ');
        const path = record.slice(tab + 1);
        if (kind !== 'blob' || mode !== '100644' || !object) throw new Error(`Unsupported fixture tree entry: ${record}`);
        this.ownedPath(path);
        this.files.set(path, this.git(['cat-file', 'blob', object]));
      }
    } catch (cause) { rmSync(this.root, { recursive: true, force: true }); throw cause; }
  }

  private git(argv: readonly string[]): Buffer {
    return execFileSync('git', ['-C', this.root, ...argv], { maxBuffer: 16 * 1024 * 1024 });
  }

  private ownedPath(path: string): string {
    const target = resolve(this.root, path);
    const local = relative(this.root, target);
    if (!local || local === '..' || local.startsWith(`..${sep}`) || local.split(sep)[0] === '.git') {
      throw new Error(`Fixture path escapes its owned worktree: ${path}`);
    }
    return target;
  }

  restore(): void {
    if (lstatSync(this.root).isSymbolicLink() || lstatSync(join(this.root, '.git')).isSymbolicLink()) throw new Error('Fixture root was replaced by a symlink');
    const directories = this.directories;
    const removeExtra = (directory: string, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!prefix && entry.name === '.git') continue;
        const path = prefix ? join(prefix, entry.name) : entry.name;
        const target = this.ownedPath(path);
        if (entry.isSymbolicLink() || (!this.files.has(path) && !directories.has(path)) ||
          (entry.isDirectory() && this.files.has(path)) || (!entry.isDirectory() && directories.has(path))) {
          rmSync(target, { recursive: true, force: true });
        } else if (entry.isDirectory()) removeExtra(target, path);
      }
    };
    removeExtra(this.root);
    for (const directory of directories) mkdirSync(this.ownedPath(directory), { recursive: true });
    for (const [path, bytes] of this.files) {
      const target = this.ownedPath(path);
      if (existsSync(target) && readFileSync(target).equals(bytes)) continue;
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.fixture-restore-${randomUUID()}`;
      try {
        writeFileSync(temporary, bytes, { flag: 'wx' });
        renameSync(temporary, target);
      } finally { rmSync(temporary, { force: true }); }
    }
    this.git(['read-tree', this.commit]);
    if (this.git(['rev-parse', 'HEAD']).toString().trim() !== this.commit) throw new Error('Browser test changed its frozen HEAD');
  }

  close(): void { rmSync(this.root, { recursive: true, force: true }); }
}

export class BrowserSharedFixture {
  readonly root: string;
  private readonly privateRoots = new Set<string>();
  private readonly privateStartupFailures = new Map<string, unknown>();
  private readonly privateServers = new Set<ViewServerHandle>();
  signal: AbortSignal | undefined;
  private frozenSourceDigest: string | undefined;

  readonly repository: FrozenBrowserRepository;
  readonly server: ViewServerHandle;
  constructor(repository: FrozenBrowserRepository, server: ViewServerHandle) {
    this.repository = repository;
    this.server = server;
    this.root = repository.root;
  }

  /** Only cases that need exclusive service state acquire a private consumer. */
  privateRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'concord-browser-exclusive-'));
    this.privateRoots.add(root);
    return root;
  }

  async privateServer(options: ViewServerOptions): Promise<ViewServerHandle> {
    if (!this.privateRoots.has(options.root)) throw new Error('Private server requires a worker-owned root');
    try {
      const server = await startViewServer({ ...options, ...(this.signal ? { signal: this.signal } : {}) });
      this.privateServers.add(server);
      return server;
    } catch (cause) {
      if (!(cause instanceof ViewServerStartupFailed) || !cause.cleanupComplete) this.privateStartupFailures.set(options.root, cause);
      throw cause;
    }
  }

  async closePrivate(): Promise<void> {
    const results = await Promise.allSettled([...this.privateServers].map(async server => {
      await server.close();
      this.privateServers.delete(server);
    }));
    const startupCleanup = await Promise.allSettled([...this.privateStartupFailures.keys()].map(async root => {
      stopWorkspaceServer(root, sourceCli());
      this.privateStartupFailures.delete(root);
    }));
    for (const root of this.privateRoots) {
      if (this.privateStartupFailures.has(root) || [...this.privateServers].some(server => server.root === root)) continue;
      rmSync(root, { recursive: true, force: true });
      this.privateRoots.delete(root);
    }
    const failures = [...results, ...startupCleanup].flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, `Private browser fixture cleanup failed; retained roots: ${[...this.privateRoots].join(', ')}`);
  }

  /** Refresh after per-case setup; all requests own their HTTP connection. */
  async ready(signal = this.signal): Promise<ViewServerHandle> {
    const requestedAt = Date.now();
    signal?.throwIfAborted();
    const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    const response = await fetchFresh(new URL('/api/workspace', this.server.address), {
      method: 'POST', signal: requestSignal(), headers: { 'content-type': 'application/json', origin: new URL(this.server.address).origin }, body: '{}',
    });
    if (response.status !== 202) throw new Error(`Workspace refresh rejected: ${response.status} ${await response.text()}`);
    await pollUntil(async () => {
      signal?.throwIfAborted();
      const result = await fetchFresh(new URL('/api/workspace', this.server.address), { signal: requestSignal() });
      if (result.status !== 200) return undefined;
      const value = parseWorkspaceProjection(await result.text());
      return value && Date.parse(value.projection.builtFrom) >= requestedAt && value.projection.changedPaths.length === 0 ? value : undefined;
    }, { description: 'worker workspace refresh after fixture setup', timeoutMs: 65_000 });
    return this.server;
  }

  async restore(signal?: AbortSignal): Promise<void> {
    this.repository.restore();
    await this.ready(signal);
    const response = await fetchFresh(new URL('/api/workspace', this.server.address), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    const value = parseWorkspaceProjection(await response.text());
    if (!value) throw new Error('Restored fixture has no workspace projection');
    this.frozenSourceDigest ??= value.projection.sourceDigest;
    if (value.projection.sourceDigest !== this.frozenSourceDigest) throw new Error('Workspace did not refresh to the frozen fixture');
  }
}

/** Scope order releases the service before deleting the worktree, including partial startup. */
export const acquireBrowserSharedFixture = Effect.fn('acquireBrowserSharedFixture')(function*(signal?: AbortSignal) {
  let serviceStopped = true;
  const repository = yield* Effect.acquireRelease(
    Effect.sync(() => new FrozenBrowserRepository()),
    repository => Effect.sync(() => {
      if (!serviceStopped) throw new Error(`Shared service cleanup is unconfirmed; retained root: ${repository.root}`);
      repository.close();
    }),
  );
  const server = yield* Effect.acquireRelease(
    Effect.tryPromise(async () => {
      serviceStopped = false;
      try { return await startViewServer({ root: repository.root, ...(signal ? { signal } : {}) }); }
      catch (cause) {
        serviceStopped = cause instanceof ViewServerStartupFailed && cause.cleanupComplete;
        throw cause;
      }
    }),
    server => Effect.tryPromise(async () => { await server.close(); serviceStopped = true; }).pipe(Effect.orDie),
  );
  serviceStopped = false;
  const fixture = new BrowserSharedFixture(repository, server);
  yield* Effect.tryPromise(() => fixture.restore(signal));
  return fixture;
});

let current: { readonly scope: Scope.Closeable; readonly fixture: BrowserSharedFixture } | undefined;

export async function openBrowserWorker(signal?: AbortSignal, workerID?: string): Promise<void> {
  return recordBrowserTiming('fixture-start', async () => {
    const scope = Effect.runSync(Scope.make());
    try {
      const fixture = await Effect.runPromise(acquireBrowserSharedFixture(signal).pipe(Scope.provide(scope)));
      current = { scope, fixture };
    } catch (cause) {
      try { await Effect.runPromise(Scope.close(scope, Exit.void)); }
      catch (cleanup) { throw new AggregateError([cause, cleanup], 'Browser worker startup and cleanup failed'); }
      throw cause;
    }
  }, workerID);
}

export function browserWorkerFixture(): BrowserSharedFixture {
  if (!current) throw new Error('Browser worker fixture requested outside engine lifecycle');
  return current.fixture;
}

export async function closeBrowserAttempt(): Promise<void> {
  await current?.fixture.closePrivate();
}

export async function closeBrowserWorker(workerID?: string): Promise<void> {
  return recordBrowserTiming('fixture-stop', async () => {
    const owned = current;
    current = undefined;
    if (owned) {
      try { await owned.fixture.closePrivate(); }
      finally { await Effect.runPromise(Scope.close(owned.scope, Exit.void)); }
    }
  }, workerID);
}
