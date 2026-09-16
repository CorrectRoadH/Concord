import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, statSync, statfsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { Data, Effect } from "effect";

const LOCK_FILE = "publication.lock";
const LOCK_CONFLICT_EXIT = 75;
const SUPPORTED_LOCAL_FILESYSTEMS = new Set([
  0x0000ef53, 0x58465342, 0x9123683e, 0x01021994, 0x2fc12fc1,
  0x794c7630, 0xf2f52010, 0x858458f6,
]);

export class CoordinationError extends Data.TaggedError("CoordinationError")<{
  readonly operation: string;
  readonly phase: "git-private" | "lock" | "cleanup";
  readonly path?: string;
  readonly message: string;
}> {}

export interface TraceLease {
  readonly descriptor: number;
  readonly directory: string;
  readonly mode: "shared" | "exclusive";
}

function gitPath(root: string, name: string): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  try {
    const output = execFileSync("git", ["-C", resolve(root), "rev-parse", "--git-path", name], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024,
    }).trim();
    if (output.length === 0) throw new Error("git returned an empty private path");
    const path = resolve(root, output);
    assertNoSymlinkPath(path);
    return path;
  } catch (cause) {
    if (cause instanceof CoordinationError) throw cause;
    throw new CoordinationError({ operation: "coordination", phase: "git-private", message: cause instanceof Error ? cause.message : String(cause) });
  }
}

function assertNoSymlinkPath(path: string): void {
  const absolute = resolve(path);
  let part: string = sep;
  for (const segment of absolute.slice(sep.length).split(sep)) {
    part = join(part, segment);
    try {
      if (lstatSync(part).isSymbolicLink()) throw new CoordinationError({ operation: "coordination", phase: "git-private", path: part, message: "symbolic links are not permitted in private coordination paths" });
    } catch (cause) {
      if (cause instanceof CoordinationError) throw cause;
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") break;
      throw cause;
    }
  }
}

export function tracePrivateDirectorySync(root: string): string { return gitPath(root, "niceeval/docs-trace"); }
export function genericPrivateDirectorySync(root: string): string { return gitPath(root, "concord"); }
export function genericJournalPath(root: string): string {
  const path = resolve(genericPrivateDirectorySync(root), "journal.json");
  assertNoSymlinkPath(path);
  return path;
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function assertSupported(root: string, directory: string, operation: string): void {
  if (statSync(resolve(root)).dev !== statSync(directory).dev) {
    throw new CoordinationError({ operation, phase: "lock", path: directory, message: "repository and Trace coordination are on different filesystems" });
  }
  for (const path of [resolve(root), directory]) {
    const type = statfsSync(path).type >>> 0;
    if (!SUPPORTED_LOCAL_FILESYSTEMS.has(type)) {
      throw new CoordinationError({ operation, phase: "lock", path, message: `unsupported filesystem type 0x${type.toString(16)}` });
    }
  }
}

function acquireNow(root: string, mode: TraceLease["mode"], operation: string, create: boolean): TraceLease | undefined {
  const directory = tracePrivateDirectorySync(root);
  const lockPath = resolve(directory, LOCK_FILE);
  if (!create && !existsSync(lockPath)) return undefined;
  assertNoSymlinkPath(dirname(lockPath));
  if (existsSync(lockPath)) assertNoSymlinkPath(lockPath);
  ensurePrivateDirectory(directory);
  assertSupported(root, directory, operation);
  const descriptor = openSync(lockPath, "a+", 0o600);
  try {
    if ((fstatSync(descriptor).mode & 0o7777) !== 0o600) fchmodSync(descriptor, 0o600);
    const result = spawnSync("flock", [mode === "shared" ? "--shared" : "--exclusive", "--nonblock", "--conflict-exit-code", String(LOCK_CONFLICT_EXIT), "3"], {
      stdio: ["ignore", "ignore", "pipe", descriptor],
    });
    if (result.error !== undefined) throw result.error;
    if (result.status === LOCK_CONFLICT_EXIT) throw new CoordinationError({ operation, phase: "lock", path: lockPath, message: `${mode} Trace lease is busy` });
    if (result.status !== 0) throw new Error(`flock helper exited ${String(result.status)}`);
    return { descriptor, directory, mode };
  } catch (cause) {
    closeSync(descriptor);
    if (cause instanceof CoordinationError) throw cause;
    throw new CoordinationError({ operation, phase: "lock", path: lockPath, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function acquireTraceLeaseSync(root: string, mode: TraceLease["mode"], operation: string, create = true): TraceLease | undefined {
  return acquireNow(root, mode, operation, create);
}

export function releaseTraceLeaseSync(lease: TraceLease, operation: string): void {
  try { closeSync(lease.descriptor); }
  catch (cause) { throw new CoordinationError({ operation, phase: "cleanup", path: LOCK_FILE, message: cause instanceof Error ? cause.message : String(cause) }); }
}

export function acquireTraceLease(root: string, mode: TraceLease["mode"], operation: string, create: boolean): Effect.Effect<TraceLease | undefined, CoordinationError> {
  return Effect.try({ try: () => acquireNow(root, mode, operation, create), catch: (cause) => cause instanceof CoordinationError ? cause : new CoordinationError({ operation, phase: "lock", path: LOCK_FILE, message: cause instanceof Error ? cause.message : String(cause) }) });
}

export function releaseTraceLease(lease: TraceLease, operation: string): Effect.Effect<void, CoordinationError> {
  return Effect.try({ try: () => releaseTraceLeaseSync(lease, operation), catch: (cause) => cause instanceof CoordinationError ? cause : new CoordinationError({ operation, phase: "cleanup", path: LOCK_FILE, message: cause instanceof Error ? cause.message : String(cause) }) });
}

export function withTraceLease<A, E, R>(root: string, mode: TraceLease["mode"], operation: string, create: boolean, use: (lease: TraceLease | undefined) => Effect.Effect<A, E, R>): Effect.Effect<A, E | CoordinationError, R> {
  return Effect.acquireUseRelease(
    acquireTraceLease(root, mode, operation, create),
    use,
    (lease) => lease === undefined ? Effect.succeed(undefined) : releaseTraceLease(lease, operation),
  );
}
