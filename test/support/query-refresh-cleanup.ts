import { basename, isAbsolute } from 'node:path';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

class RefreshCleanupError extends Schema.TaggedError<RefreshCleanupError>()('RefreshCleanupError', { message: Schema.String }) {}
const io = <A>(message: string, thunk: () => A) => Effect.try({ try: thunk, catch: cause => new RefreshCleanupError({ message: `${message}: ${String(cause)}` }) });
const processListing = Effect.scoped(Effect.gen(function*() {
  const child = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(ChildProcess.make('ps', ['-ww', '-axo', 'pid=,command='], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  const result = yield* Effect.all({ code: child.exitCode, stdout: Stream.mkString(Stream.decodeText(child.stdout)), stderr: Stream.mkString(Stream.decodeText(child.stderr)) }, { concurrency: 'unbounded' });
  if (result.code !== 0) return yield* Effect.fail(new RefreshCleanupError({ message: `List refresh processes: ${result.stderr}` }));
  return result.stdout;
}));

/** Match invocation positions, never a role or root mentioned inside another argument. */
export function isRefreshArguments(argv: readonly string[], root: string): boolean {
  let entry = 1;
  while (['--no-env-file', '--config=/dev/null', '--conditions=concord-source'].includes(argv[entry] ?? '')) entry++;
  return argv[entry] === '--concord-internal'
    ? argv[entry + 1] === 'query-refresh-worker' && argv[entry + 2] === root
    : /[/\\]query-refresh-worker\.(?:ts|js)$/u.test(argv[entry] ?? '') && argv[entry + 1] === root;
}

const RefreshQuery = Schema.fromJsonString(Schema.Array(Schema.String));
/** A flattened ps line must still contain one complete root followed by the request. */
export function isRefreshCommand(command: string, root: string): boolean {
  const marker = ` ${root} `, start = command.indexOf(marker);
  if (start < 0) return false;
  const prefix = command.slice(0, start);
  // ps does not quote paths. Match complete entry boundaries rather than splitting paths.
  if (/(?:^|\s)(?:-e|--eval|-p|--print|-c|--command)(?:\s|=|$)/u.test(prefix)) return false;
  const internal = ' --concord-internal query-refresh-worker';
  if (prefix.endsWith(internal)) {
    const executable = prefix.slice(0, -internal.length);
    if (!isAbsolute(executable) || basename(executable) !== 'concord') return false;
  } else {
    const source = /^(.+[/\\](?:bun|node)(?:\.exe)?) ((?:(?:--no-env-file|--config=\/dev\/null|--conditions=concord-source) )*)(.+[/\\]query-refresh-worker\.(?:ts|js))$/u.exec(prefix);
    if (!source || !isAbsolute(source[1]!) || !isAbsolute(source[3]!)) return false;
  }
  const request = /^(\[.*\]) \d+(?: \d+)?$/u.exec(command.slice(start + marker.length));
  return request !== null && Schema.decodeUnknownExit(RefreshQuery)(request[1])._tag === 'Success';
}

/** Identify only refresh children belonging to this exact consumer root. */
export const refreshPids = Effect.fn('test.refreshPids')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const stdout = yield* processListing;
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (!match || !match[2]!.includes('query-refresh-worker')) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (process.platform === 'linux') {
      // ps flattens argument boundaries, including roots containing whitespace.
      const bytes = yield* Effect.result(fs.readFileString(`/proc/${pid}/cmdline`));
      if (bytes._tag === 'Success' && isRefreshArguments(bytes.success.split('\0'), root)) pids.push(pid);
    } else {
      // The request tail disambiguates whitespace in a root from another argument.
      if (isRefreshCommand(match[2]!, root)) pids.push(pid);
    }
  }
  return pids;
});

/** Let owned detached refreshes publish and exit before deleting the consumer. */
export const settleRefreshes = Effect.fn('test.settleRefreshes')(function*(root: string, preexisting: readonly number[] = [], timeoutMs = 150_000) {
  const settled = yield* Effect.gen(function*() {
    for (;;) {
      const pids = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
      if (pids.length === 0) return;
      yield* Effect.sleep('250 millis');
    }
  }).pipe(Effect.timeoutOption(timeoutMs));
  if (settled._tag === 'None') {
    const pids = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
    yield* io('Stop owned refresh processes', () => {
      for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; } }
    });
    yield* Effect.sleep('1 second');
    const remaining = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
    yield* io('Kill owned refresh processes', () => {
      for (const pid of remaining) { try { process.kill(pid, 'SIGKILL'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; } }
    });
    yield* Effect.sleep('100 millis');
    if ((yield* refreshPids(root)).some(pid => !preexisting.includes(pid))) return yield* new RefreshCleanupError({ message: `Refresh cleanup unconfirmed for ${root}` });
  }
});
