// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Effect } from 'effect';
import { acquireFileLease, assertLeasePath, CoordinationError, recoverFileLease, releaseFileLease, type FileLease } from './file-lease.js';
export { CoordinationError } from './file-lease.js';
export { invalidateActiveRun } from './run-coordination.js';
export type TraceLease = FileLease;
const TRACE_PRIVATE_PATH = 'concord/trace';
const LEGACY_TRACE_PRIVATE_PATH = 'niceeval/docs-trace';
export const PUBLICATION_LEASE = 'publication.lease';

function gitPath(root: string, name: string): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  try {
    const output = execFileSync("git", ["-C", resolve(root), "rev-parse", "--git-path", name], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024,
    }).trim();
    if (output.length === 0) throw new Error("git returned an empty private path");
    const path = resolve(root, output);
    assertLeasePath(path);
    return path;
  } catch (cause) {
    if (cause instanceof CoordinationError) throw cause;
    throw new CoordinationError({ operation: "coordination", phase: "git-private", message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function tracePrivateDirectorySync(root: string): string { return gitPath(root, TRACE_PRIVATE_PATH); }
export function legacyTracePrivateDirectorySync(root: string): string { return gitPath(root, LEGACY_TRACE_PRIVATE_PATH); }
export function genericPrivateDirectorySync(root: string): string { return gitPath(root, "concord"); }
export function genericJournalPath(root: string): string {
  const path = resolve(genericPrivateDirectorySync(root), "journal.json");
  assertLeasePath(path);
  return path;
}


/** Historical payloads are refused, never migrated by ordinary runtime. */
export function assertLegacyTraceStateMigratedSync(root: string, operation: string): void {
  const directory = legacyTracePrivateDirectorySync(root);
  if (!existsSync(directory)) return;
  assertLeasePath(directory);
  const payload = readdirSync(directory).filter(name => name !== 'publication.lock' && name !== PUBLICATION_LEASE && !name.startsWith(`.${PUBLICATION_LEASE}-`));
  if (payload.length > 0) throw new CoordinationError({ operation, phase: 'migration', path: directory, message: 'Historical Trace state is unsupported; preserve it and use its original offline recovery tools.' });
}

function acquireNow(root: string, mode: TraceLease['mode'], operation: string, create: boolean): TraceLease | undefined {
  assertLegacyTraceStateMigratedSync(root, operation);
  return acquireFileLease(root, tracePrivateDirectorySync(root), PUBLICATION_LEASE, mode, operation, create);
}

export function recoverPublicationLeaseSync(root: string): void {
  recoverFileLease(root, join(tracePrivateDirectorySync(root), PUBLICATION_LEASE), 'recover');
}

// These helpers belong to the existing offline governance migration tool. They
// do not provide mixed-version lock compatibility or a runtime migration path.
export interface CoordinationMigrationLeases { readonly legacy: TraceLease; readonly current: TraceLease; }
export function acquireCoordinationMigrationLeasesSync(root: string, operation: string): CoordinationMigrationLeases {
  const legacy = acquireFileLease(root, legacyTracePrivateDirectorySync(root), PUBLICATION_LEASE, 'exclusive', operation)!;
  try { return { legacy, current: acquireFileLease(root, tracePrivateDirectorySync(root), PUBLICATION_LEASE, 'exclusive', operation)! }; }
  catch (cause) { releaseFileLease(legacy, operation); throw cause; }
}
export function releaseCoordinationMigrationLeasesSync(leases: CoordinationMigrationLeases, operation: string): void {
  try { releaseFileLease(leases.current, operation); } finally { releaseFileLease(leases.legacy, operation); }
}
export function acquireTraceLeaseSync(root: string, mode: TraceLease['mode'], operation: string, create = true): TraceLease | undefined {
  return acquireNow(root, mode, operation, create);
}
export function releaseTraceLeaseSync(lease: TraceLease, operation: string): void { releaseFileLease(lease, operation); }
export function acquireTraceLease(root: string, mode: TraceLease['mode'], operation: string, create: boolean): Effect.Effect<TraceLease | undefined, CoordinationError> {
  return Effect.try({ try: () => acquireNow(root, mode, operation, create), catch: cause => cause instanceof CoordinationError ? cause : new CoordinationError({ operation, phase: 'lock', message: cause instanceof Error ? cause.message : String(cause) }) });
}
export function releaseTraceLease(lease: TraceLease, operation: string): Effect.Effect<void, CoordinationError> {
  return Effect.try({ try: () => releaseTraceLeaseSync(lease, operation), catch: cause => cause instanceof CoordinationError ? cause : new CoordinationError({ operation, phase: 'cleanup', message: cause instanceof Error ? cause.message : String(cause) }) });
}
export function withTraceLease<A, E, R>(root: string, mode: TraceLease['mode'], operation: string, create: boolean, use: (lease: TraceLease | undefined) => Effect.Effect<A, E, R>): Effect.Effect<A, E | CoordinationError, R> {
  return Effect.acquireUseRelease(acquireTraceLease(root, mode, operation, create), use, lease => lease === undefined ? Effect.succeed(undefined) : releaseTraceLease(lease, operation));
}
