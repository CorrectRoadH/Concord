// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#浏览器与诊断
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { inspect } from 'node:util';
import { Effect, Exit, Scope } from 'effect';
import { startViewServer, ViewServerStartupFailed, type ViewServerHandle, type ViewServerOptions } from '../e2e/server.ts';
import { sourceCli } from './source-consumer.ts';
import { initialize } from './operations.ts';
import { LocalRepository } from './repository.ts';
import { fetchFresh, parseWorkspaceProjection, pollUntil } from './support.ts';
import { tmpdir } from './temporary.ts';
import { stopWorkspaceServer } from './stop-workspace-server.ts';
import { recordBrowserTiming, type BrowserAttemptTimer } from '../../scripts/gate-timings.ts';
import { retainConsumer } from './consumer.ts';

/** Files are recovered from an immutable Git tree; .git and live handles stay owned by the worker. */
export class FrozenBrowserRepository {
  readonly root: string;
  readonly commit: string;
  private readonly files = new Map<string, { readonly bytes: Buffer; readonly mode: number }>();
  private readonly directories = new Set<string>();
  private readonly head: Buffer;
  private readonly refs: Buffer;
  private readonly index: Buffer;
  private readonly indexEntries: Buffer;
  private readonly gitConfig: Buffer;
  private readonly gitInfo = new Map<string, Buffer | undefined>();
  private preserve = false;
  get retained(): boolean { return this.preserve; }

  static async open(root?: string): Promise<FrozenBrowserRepository> {
    const directory = root ?? mkdtempSync(join(tmpdir(), 'concord-browser-worker-'));
    try {
      if (root === undefined) {
        execFileSync('git', ['init', '-q', directory]);
        const repo = await LocalRepository.open(directory, { initialize: true });
        try { await initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
      }
      return new FrozenBrowserRepository(directory);
    } catch (cause) { rmSync(directory, { recursive: true, force: true }); throw cause; }
  }

  private constructor(root: string) {
    this.root = root;
    try {
      const captureTree = (directory: string, prefix = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (!prefix && entry.name === '.git') continue;
          const path = prefix ? join(prefix, entry.name) : entry.name;
          const target = this.ownedPath(path);
          if (entry.isDirectory()) { this.directories.add(path); captureTree(target, path); }
          else if (entry.isFile()) this.files.set(path, { bytes: readFileSync(target), mode: lstatSync(target).mode & 0o777 });
          else throw new Error(`Unsupported fixture tree entry: ${path}`);
        }
      };
      captureTree(this.root);
      this.git(['add', '--all']);
      this.git(['-c', 'user.name=Concord fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Browser fixture']);
      this.commit = this.git(['rev-parse', 'HEAD']).toString().trim();
      this.head = readFileSync(join(this.root, '.git/HEAD'));
      this.refs = this.git(['for-each-ref', '--format=%(refname) %(objectname)']);
      this.index = readFileSync(join(this.root, '.git/index'));
      this.indexEntries = this.git(['ls-files', '--stage', '-v', '-z']);
      this.gitConfig = readFileSync(join(this.root, '.git/config'));
      for (const path of ['info/exclude', 'info/attributes']) {
        const target = join(this.root, '.git', path);
        this.gitInfo.set(path, existsSync(target) ? readFileSync(target) : undefined);
      }
    } catch (cause) { rmSync(this.root, { recursive: true, force: true }); throw cause; }
  }

  private git(argv: readonly string[]): Buffer {
    return execFileSync('git', ['-C', this.root, `--git-dir=${join(this.root, '.git')}`, `--work-tree=${this.root}`, ...argv], { maxBuffer: 16 * 1024 * 1024 });
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
    // Check history before touching files or index, so a changed HEAD keeps its evidence.
    try {
      if (!lstatSync(join(this.root, '.git/HEAD')).isFile() || !readFileSync(join(this.root, '.git/HEAD')).equals(this.head) ||
        this.git(['rev-parse', 'HEAD']).toString().trim() !== this.commit ||
        !this.git(['for-each-ref', '--format=%(refname) %(objectname)']).equals(this.refs)) {
        throw new Error('Frozen history differs');
      }
    } catch (cause) {
      this.preserve = true;
      throw new Error(`Browser test changed its frozen HEAD or refs; retained root: ${this.root}`, { cause });
    }
    const directories = this.directories;
    const removeExtra = (directory: string, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!prefix && entry.name === '.git') continue;
        const path = prefix ? join(prefix, entry.name) : entry.name;
        const target = this.ownedPath(path);
        if ((!entry.isFile() && !entry.isDirectory()) || (!this.files.has(path) && !directories.has(path)) ||
          (entry.isDirectory() && this.files.has(path)) || (!entry.isDirectory() && directories.has(path))) {
          rmSync(target, { recursive: true, force: true });
        } else if (entry.isDirectory()) removeExtra(target, path);
      }
    };
    removeExtra(this.root);
    for (const directory of directories) {
      const target = this.ownedPath(directory);
      if (!existsSync(target)) mkdirSync(target, { recursive: true });
    }
    for (const [path, { bytes, mode }] of this.files) {
      const target = this.ownedPath(path);
      if (existsSync(target) && readFileSync(target).equals(bytes)) {
        if ((lstatSync(target).mode & 0o777) !== mode) chmodSync(target, mode);
        continue;
      }
      this.replace(target, bytes, mode);
    }
    const config = join(this.root, '.git/config');
    if (!lstatSync(config, { throwIfNoEntry: false })?.isFile() || !readFileSync(config).equals(this.gitConfig)) {
      if (lstatSync(config, { throwIfNoEntry: false }) && !lstatSync(config).isFile()) rmSync(config, { recursive: true, force: true });
      this.replace(config, this.gitConfig, 0o644);
    }
    const info = join(this.root, '.git/info');
    const infoStat = lstatSync(info, { throwIfNoEntry: false });
    if (infoStat && !infoStat.isDirectory()) rmSync(info, { recursive: true, force: true });
    if (!infoStat?.isDirectory()) mkdirSync(info);
    for (const [path, bytes] of this.gitInfo) {
      const target = join(this.root, '.git', path);
      const stat = lstatSync(target, { throwIfNoEntry: false });
      if (bytes === undefined) { if (stat) rmSync(target, { recursive: true, force: true }); }
      else if (!stat?.isFile() || !readFileSync(target).equals(bytes)) {
        if (stat && !stat.isFile()) rmSync(target, { recursive: true, force: true });
        this.replace(target, bytes, 0o644);
      }
    }
    if (!this.git(['ls-files', '--stage', '-v', '-z']).equals(this.indexEntries)) {
      if (existsSync(join(this.root, '.git/index.lock'))) throw new Error('Browser fixture index is still owned by another operation');
      this.replace(join(this.root, '.git/index'), this.index, 0o644);
    }
  }

  private replace(target: string, bytes: Buffer, mode: number): void {
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.fixture-restore-${randomUUID()}`;
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode });
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
  }

  close(): void { if (!this.preserve) rmSync(this.root, { recursive: true, force: true }); }
}

export class BrowserSharedFixture {
  readonly root: string;
  private readonly privateRoots = new Set<string>();
  private readonly privateStartupFailures = new Map<string, unknown>();
  private readonly privateServers = new Set<ViewServerHandle>();
  signal: AbortSignal | undefined;
  timer: BrowserAttemptTimer | undefined;
  private frozenSourceDigest: string | undefined;
  private previousAttempt: Promise<void> = Promise.resolve();

  /** A rejected close stays rejected: another case must never restore through it. */
  finishAttempt(closeContext: () => Promise<void>): Promise<void> {
    const previous = this.previousAttempt;
    const closing = (async () => {
      try { await closeContext(); }
      finally {
        if (this.timer) await this.timer.measure('private-cleanup', async () => (await this.closePrivate()));
        else await this.closePrivate();
      }
    })();
    this.previousAttempt = Promise.allSettled([previous, closing]).then(outcomes => {
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, 'Browser attempt closure is unconfirmed');
    });
    return this.previousAttempt;
  }

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

  async closePrivate(finalRelease = false): Promise<void> {
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
    if (finalRelease && failures.length) {
      for (const root of this.privateRoots) if (existsSync(root)) retainConsumer(root);
    }
    if (failures.length) throw new AggregateError(failures, `Private browser fixture cleanup failed; retained roots: ${[...this.privateRoots].join(', ')}`);
  }

  /** Refresh after per-case setup; all requests own their HTTP connection. */
  async ready(signal = this.signal, phase: 'setup-refresh' | 'restore-refresh' = 'setup-refresh', expectedSourceDigest?: string): Promise<ViewServerHandle> {
    const end = this.timer?.begin(phase);
    let success = false;
    try {
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
        return value && Date.parse(value.projection.builtFrom) >= requestedAt && value.projection.changedPaths.length === 0 &&
          value.projection.status === 'ready' && (phase !== 'restore-refresh' || value.projection.complete && value.snapshot.complete) &&
          (expectedSourceDigest === undefined || value.projection.sourceDigest === expectedSourceDigest) ? value : undefined;
      }, { description: 'worker workspace refresh after fixture setup', timeoutMs: 65_000 });
      success = true;
      return this.server;
    } finally { end?.(success); }
  }

  async restore(signal?: AbortSignal): Promise<void> {
    await this.previousAttempt;
    if (this.timer) this.timer.sync('frozen-files', () => this.repository.restore());
    else this.repository.restore();
    await this.ready(signal, 'restore-refresh', this.frozenSourceDigest);
    const end = this.timer?.begin('frozen-verification');
    let success = false;
    try {
      const response = await fetchFresh(new URL('/api/workspace', this.server.address), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
      const value = parseWorkspaceProjection(await response.text());
      if (!value) throw new Error('Restored fixture has no workspace projection');
      this.frozenSourceDigest ??= value.projection.sourceDigest;
      if (value.projection.sourceDigest !== this.frozenSourceDigest) throw new Error('Workspace did not refresh to the frozen fixture');
      success = true;
    } finally { end?.(success); }
  }
}

/** Scope order releases the service before deleting the worktree, including partial startup. */
export const acquireBrowserSharedFixture = Effect.fn('acquireBrowserSharedFixture')(function*(signal?: AbortSignal, createRepository: () => Promise<FrozenBrowserRepository> = () => FrozenBrowserRepository.open()) {
  let serviceStopped = true;
  const repository = yield* Effect.acquireRelease(
    Effect.tryPromise(() => createRepository()),
    repository => Effect.sync(() => {
      if (!serviceStopped) {
        if (existsSync(repository.root)) retainConsumer(repository.root);
        throw new Error(`Shared service cleanup is unconfirmed; retained root: ${repository.root}`);
      }
      if (repository.retained && existsSync(repository.root)) retainConsumer(repository.root);
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

class BrowserWorkerStartupFailed extends Error {
  constructor(cause: unknown) {
    super(`Browser worker startup failed: ${inspect(cause, { depth: 8 })}`, { cause });
    this.name = 'BrowserWorkerStartupFailed';
  }
}

export async function openBrowserWorker(signal?: AbortSignal, workerID?: string): Promise<void> {
  return recordBrowserTiming('fixture-start', async () => {
    const scope = Effect.runSync(Scope.make());
    try {
      const fixture = await Effect.runPromise(acquireBrowserSharedFixture(signal).pipe(Scope.provide(scope)));
      current = { scope, fixture };
    } catch (cause) {
      try { await Effect.runPromise(Scope.close(scope, Exit.void)); }
      catch (cleanup) { throw new BrowserWorkerStartupFailed(new AggregateError([cause, cleanup], 'Browser worker startup and cleanup failed')); }
      throw new BrowserWorkerStartupFailed(cause);
    }
  }, workerID);
}

export function browserWorkerFixture(): BrowserSharedFixture {
  if (!current) throw new Error('Browser worker fixture requested outside engine lifecycle');
  return current.fixture;
}

export async function closeBrowserAttempt(closeContext: () => Promise<void>): Promise<void> {
  if (current) await current.fixture.finishAttempt(closeContext);
  else await closeContext();
}

export async function closeBrowserWorker(workerID?: string): Promise<void> {
  return recordBrowserTiming('fixture-stop', async () => {
    const owned = current;
    current = undefined;
    if (owned) {
      try { await owned.fixture.closePrivate(true); }
      finally { await Effect.runPromise(Scope.close(owned.scope, Exit.void)); }
    }
  }, workerID);
}
