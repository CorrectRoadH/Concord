import { randomUUID, createHash } from 'node:crypto';
import { resolve, isAbsolute, join, dirname } from 'node:path';
import { Clock, DateTime, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { fail, problem } from './model.js';

export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
export const hash = (value: string | Uint8Array) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const objectHash = (value: unknown) => hash(canonical(value));
export function tailSummary(value: string): string {
  const bytes = Buffer.from(value, 'utf8').subarray(-4096);
  let start = 0;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}
export const now = Clock.currentTimeMillis.pipe(Effect.map(ms => DateTime.formatIso(DateTime.makeUnsafe(ms))));
export const decode = <A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown, label: string) => Effect.try({
  try: () => Schema.decodeUnknownSync(schema, { onExcessProperty: 'error', errors: 'all' })(value),
  catch: () => problem(`Invalid ${label}`, [{ code: 'UnsafePath', message: `Invalid ${label}` }]),
});

function makeGroupCleanup(pid: number) {
    const ownedModule = new URL(import.meta.url).pathname.endsWith('.ts') ? '../../../src/owned-process.ts' : '../../../owned-process.js';
    let cleaned: boolean | undefined;
    const cleanup = Effect.uninterruptible(Effect.gen(function*() {
      if (cleaned !== undefined) return cleaned;
      const observer = yield* Effect.tryPromise(() => import(ownedModule) as Promise<{ observeOwnedProcessGroup: (pid: number) => 'gone' | 'zombie-only' | 'alive' | 'unknown' }>);
      const send = (signal: NodeJS.Signals) => Effect.sync(() => {
        try { process.kill(-pid, signal); } catch { /* observation below determines success */ }
      });
      const wait = Effect.fn('DocsWork.waitGroup')(function*(attempts: number) {
        for (let attempt = 0; attempt < attempts; attempt++) {
          const state = observer.observeOwnedProcessGroup(pid);
          if (state !== 'alive') return state === 'gone' || state === 'zombie-only';
          yield* Effect.sleep(50);
        }
        return false;
      });
      yield* send('SIGTERM');
      if (!(yield* wait(10))) { yield* send('SIGKILL'); cleaned = yield* wait(10); }
      else cleaned = true;
      return cleaned;
    })).pipe(Effect.catch(() => Effect.succeed(false)));
  return cleanup;
}

// Every child has an owned POSIX process group, including commands which exit
// before their descendants. Stream draining and leader waiting share one timeout.
export const runProcess = Effect.fn('DocsWork.runProcess')(function*(root: string, argv: readonly string[], timeoutMs = 600000) {
  if (argv.length === 0) return yield* fail('DocsWorkPlanInvalid', 'Empty command');
  if (argv.reduce((bytes, arg) => bytes + Buffer.byteLength(arg) + 1, 0) > 128 * 1024) return yield* fail('DocsWorkArgvTooLong', 'Expanded argv exceeds 128 KiB');
  return yield* Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const resource = yield* Effect.acquireRelease(
      spawner.spawn(ChildProcess.make(argv[0]!, argv.slice(1), {
        cwd: root, shell: false, detached: true, stdin: 'ignore', killSignal: 'SIGKILL',
      })).pipe(Effect.map(handle => ({ handle, cleanup: makeGroupCleanup(handle.pid) }))),
      resource => resource.cleanup,
    );
    const { handle, cleanup } = resource;
    let tail = Buffer.alloc(0);
    const outputHash = createHash('sha256');
    const output = Stream.runForEach(handle.all, bytes => Effect.sync(() => {
      outputHash.update(bytes);
      tail = Buffer.concat([tail, Buffer.from(bytes)]).subarray(-4096);
    }));
    const code = yield* Effect.all([handle.exitCode.pipe(Effect.catch(() => Effect.succeed(null))), output], { concurrency: 'unbounded' }).pipe(
      Effect.map(([code]) => code === null ? null : Number(code)), Effect.timeoutOption(timeoutMs),
    );
    const groupGone = yield* cleanup;
    const exitCode = groupGone && code._tag === 'Some' ? code.value : null;
    return { exitCode, outputDigest: `sha256:${outputHash.digest('hex')}`, summary: tailSummary(tail.toString('utf8')) || (exitCode === null ? 'Command timed out or terminated' : `Command exited ${exitCode}`) };
  })).pipe(Effect.catch(error => Effect.succeed({ exitCode: null, outputDigest: hash(String(error)), summary: tailSummary(String(error)) })));
});
export const git = Effect.fn('DocsWork.git')(function*(root: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(Effect.gen(function*() {
    const handle = yield* spawner.spawn(ChildProcess.make('git', args, { cwd: root, shell: false, stdin: 'ignore' }));
    const [code, output] = yield* Effect.all([handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))], { concurrency: 'unbounded' });
    if (code !== 0) return yield* fail('DocsWorkPlanInvalid', `Git command failed: ${args[0]}`);
    return output;
  }));
});
export const nul = (source: string) => source.split('\0').filter(Boolean);
export const within = (path: string, prefix: string) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
export const prefix = (entry: string) => entry.split('/').slice(0, entry.split('/').findIndex(segment => segment.includes('*')) < 0 ? undefined : entry.split('/').findIndex(segment => segment.includes('*'))).join('/').replace(/\/$/u, '');
export const overlap = (a: string, b: string) => within(prefix(a), prefix(b)) || within(prefix(b), prefix(a));
export function matches(path: string, entry: string): boolean {
  if (!entry.includes('*')) return entry.endsWith('/') ? within(path, entry.slice(0, -1)) : path === entry;
  const segments = entry.split('/');
  const expression = segments.map((segment, index) => segment === '**' ? index === segments.length - 1 ? '.*' : '(?:[^/]+/)*' : segment.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('[^/]*') + (index < segments.length - 1 ? '/' : '')).join('');
  return new RegExp(`^${expression}$`, 'u').test(path);
}
export const safePath = Effect.fn('DocsWork.safePath')(function*(root: string, path: string) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some((part, index, all) => part === '..' || part === '.' || part === '.git' || part === '' && index !== all.length - 1)) return yield* problem('Unsafe path', [{ code: 'UnsafePath', path, message: 'Expected a canonical repository-relative path' }]);
  const fs = yield* FileSystem.FileSystem;
  const parts = path.replace(/\/$/u, '').split('/');
  let absolute = root;
  for (const part of parts) {
    if (part.includes('*')) break;
    absolute = join(absolute, part);
    // realPath follows links; equality rejects links even when their targets are
    // within the repository. Missing final paths are valid write ownership.
    const link = yield* fs.readLink(absolute).pipe(Effect.option);
    if (link._tag === 'Some') return yield* problem('Symlink path', [{ code: 'UnsafePath', path, message: 'Symlink components are forbidden' }]);
    const real = yield* fs.realPath(absolute).pipe(Effect.catch(error => error.reason._tag === 'NotFound' ? Effect.succeed(undefined) : Effect.fail(error)));
    if (real !== undefined && real !== absolute) return yield* problem('Symlink path', [{ code: 'UnsafePath', path, message: 'Symlink components are forbidden' }]);
  }
});
export const expand = Effect.fn('DocsWork.expand')(function*(root: string, entries: readonly string[], files: readonly string[], read = false) {
  const result = new Set<string>();
  for (const entry of entries) {
    yield* safePath(root, entry);
    const found = files.filter(file => matches(file, entry));
    if (found.length > 10000) return yield* problem('Glob limit', [{ code: 'GlobLimit', path: entry, message: 'More than 10000 matches' }]);
    if (read && found.length === 0) return yield* problem('Empty read', [{ code: 'EmptyRead', path: entry, message: 'Read matches no files' }]);
    if (!entry.includes('*') && !entry.endsWith('/')) result.add(entry);
    for (const file of found) { yield* safePath(root, file); result.add(file); }
  }
  return [...result].sort();
});
export const snapshotPaths = Effect.fn('DocsWork.snapshotPaths')(function*(root: string, paths: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* Effect.forEach([...new Set(paths)].sort(), path => Effect.gen(function*() {
    yield* safePath(root, path);
    const content = yield* fs.readFile(join(root, path)).pipe(Effect.catch(error => error.reason._tag === 'NotFound' ? Effect.succeed(undefined) : Effect.fail(error)));
    return { path, digest: content === undefined ? null : hash(content) };
  }));
  return entries;
});
export const digestPaths = (root: string, paths: readonly string[]) => snapshotPaths(root, paths).pipe(Effect.map(objectHash));
export const statePath = Effect.fn('DocsWork.statePath')(function*(root: string, runId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(runId)) return yield* problem('Invalid run ID', [{ code: 'UnsafePath', message: 'Invalid run ID' }]);
  const value = (yield* git(root, ['rev-parse', '--git-path', `concord/docs-work/v1/${runId}`])).trim();
  const target = resolve(root, value);
  yield* safeStatePath(target);
  return target;
});
const safeStatePath = Effect.fn('DocsWork.safeStatePath')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  let cursor = path;
  while (cursor !== dirname(cursor)) {
    const link = yield* fs.readLink(cursor).pipe(Effect.option);
    if (link._tag === 'Some') return yield* fail('DocsWorkPlanInvalid', 'Symlink in Git-private state path');
    const real = yield* fs.realPath(cursor).pipe(Effect.catch(error => error.reason._tag === 'NotFound' ? Effect.succeed(undefined) : Effect.fail(error)));
    if (real !== undefined && real !== cursor) return yield* fail('DocsWorkPlanInvalid', 'Symlink in Git-private state path');
    cursor = dirname(cursor);
  }
});
export const atomicJson = Effect.fn('DocsWork.atomicJson')(function*(path: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem;
  yield* safeStatePath(path);
  yield* fs.makeDirectory(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.tmp-${randomUUID()}`);
  yield* Effect.scoped(Effect.gen(function*() {
    const file = yield* fs.open(tmp, { flag: 'wx', mode: 0o600 });
    yield* file.writeAll(new TextEncoder().encode(`${canonical(value)}\n`));
    yield* file.sync;
  }));
  yield* fs.rename(tmp, path);
  yield* Effect.scoped(Effect.gen(function*() { const dir = yield* fs.open(dirname(path), { flag: 'r' }); yield* dir.sync; }));
});
export const readJson = Effect.fn('DocsWork.readJson')(function*<A>(path: string, schema: Schema.ConstraintDecoder<A, never>) {
  const fs = yield* FileSystem.FileSystem;
  yield* safeStatePath(path);
  const source = yield* fs.readFileString(path);
  const value = yield* Effect.try({ try: () => JSON.parse(source) as unknown, catch: () => fail('DocsWorkReceiptMismatch', 'Invalid state JSON') });
  return yield* decode(schema, value, 'state');
});
export const withLock = <A, E, R>(path: string, operation: Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* safeStatePath(join(path, 'lock'));
  yield* Effect.acquireRelease(fs.open(join(path, 'lock'), { flag: 'wx', mode: 0o600 }).pipe(Effect.mapError(() => fail('DocsWorkBusy', 'Run is locked'))), () => fs.remove(join(path, 'lock')).pipe(Effect.ignore));
  const directories = [path, join(path, 'receipts')];
  for (const directory of directories) {
    if (!(yield* fs.exists(directory))) continue;
    yield* safeStatePath(directory);
    for (const name of yield* fs.readDirectory(directory)) if (name.startsWith('.tmp-')) yield* fs.remove(join(directory, name), { recursive: true, force: true });
  }
  return yield* operation;
}));
