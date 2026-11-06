import { TraceMutationError, type TraceCoordinationError } from "../../model/index.ts";
import { execFileSync } from "node:child_process";
import { validPackagePath } from "../../model/index.ts";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { Cause, Effect, Exit, Result, Schema, SchemaIssue } from "effect";

import { acquireTraceLease, genericJournalPath, recoverPublicationLeaseSync, releaseTraceLease, tracePrivateDirectorySync, type TraceLease } from "./coordination.ts";
import { invalidateActiveRun } from "./run-coordination.ts";

import { TraceRecoveryConflict, TraceRecoveryRequired } from "../../model/index.ts";


const COORDINATION_ID_FILE = "coordination-id";
const JOURNAL_FILE = "publication-journal.json";
const MAXIMUM_OWNER_BYTES = 32 * 1024 * 1024;

export type TraceDirectoryManifestEntry =
  | { readonly kind: "directory"; readonly path: string; readonly mode: number }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly mode: number;
      readonly byteLength: number;
      readonly digest: string;
    };

export interface TraceRecoveryReceipt {
  readonly format: "concord.docs-trace/recovery/v1";
  readonly operation: "trace-recover";
  readonly recovered: boolean;
  readonly action: "none" | "discarded-unpublished" | "rolled-back" | "completed" | "finished-discard";
  readonly owner?: string;
}

interface FileSnapshotAbsent { readonly kind: "absent" }
interface FileSnapshotPresent {
  readonly kind: "file";
  readonly bytes: Buffer;
  readonly digest: string;
  readonly byteLength: number;
  readonly mode: number;
}
type FileSnapshot = FileSnapshotAbsent | FileSnapshotPresent;

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const DigestSchema = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u));
const ModeSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const IdentityPartSchema = Schema.Struct({ path: Schema.String, device: Schema.String, inode: Schema.String });
const WorktreeIdentitySchema = Schema.Struct({
  root: IdentityPartSchema,
  gitDir: IdentityPartSchema,
  commonDir: IdentityPartSchema,
  coordinationId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
});
const ManifestEntrySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("directory"), path: Schema.String, mode: ModeSchema }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: Schema.String,
    mode: ModeSchema,
    byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    digest: DigestSchema,
  }),
]);
const JournalCommon = {
  format: Schema.Literal("concord.trace/publication-journal/v1"),
  token: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
  operation: NonEmptyTrimmedString,
  owner: NonEmptyTrimmedString,
  snapshotDigest: DigestSchema,
  headCommit: NonEmptyTrimmedString,
  indexEntry: Schema.NullOr(Schema.String),
  identity: WorktreeIdentitySchema,
  createdAt: NonEmptyTrimmedString,
  process: Schema.Struct({ pid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), host: NonEmptyTrimmedString }),
} as const;
const FileJournalSchema = Schema.Struct({
  ...JournalCommon,
  publication: Schema.Literal("file-replace"),
  phase: Schema.Literals(["prepared", "committed"]),
  temporary: NonEmptyTrimmedString,
  preimage: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("absent") }),
    Schema.Struct({
      kind: Schema.Literal("file"),
      bytesBase64: Schema.String,
      digest: DigestSchema,
      byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      mode: ModeSchema,
    }),
  ]),
  planned: Schema.Struct({ digest: DigestSchema, byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), mode: ModeSchema }),
});
const DirectoryJournalSchema = Schema.Struct({
  ...JournalCommon,
  publication: Schema.Literals(["new-feedback-directory", "new-docs-directory"]),
  phase: Schema.Literals(["prepared", "committed", "discarding-stage"]),
  stage: NonEmptyTrimmedString,
  target: NonEmptyTrimmedString,
  manifest: Schema.Array(ManifestEntrySchema).pipe(Schema.check(Schema.isMinLength(1))),
});
const JournalSchema = Schema.Union([FileJournalSchema, DirectoryJournalSchema]);
type FileJournal = typeof FileJournalSchema.Type;
type DirectoryJournal = typeof DirectoryJournalSchema.Type;
type PublicationJournal = typeof JournalSchema.Type;
type ManifestEntry = typeof ManifestEntrySchema.Type;
type WorktreeIdentity = typeof WorktreeIdentitySchema.Type;

export function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function mutationFailure(operation: string, phase: TraceMutationError["phase"], cause: unknown, path?: string): TraceMutationError {
  return new TraceMutationError({ operation, phase, ...(path === undefined ? {} : { path }), message: message(cause) });
}

export function traceDigest(bytes: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function slash(path: string): string { return path.split(sep).join("/"); }

function repositoryPath(root: string, path: string, operation: string): string {
  if (path.length === 0 || isAbsolute(path) || path.includes("\\") || path.includes("\0")) {
    throw mutationFailure(operation, "read", "path must be a canonical repository-relative path", path);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw mutationFailure(operation, "read", "path contains an unsafe segment", path);
  }
  const repository = resolve(root);
  const target = resolve(repository, path);
  if (!target.startsWith(`${repository}${sep}`)) throw mutationFailure(operation, "read", "path escapes repository root", path);
  return target;
}

function gitOutput(root: string, operation: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: resolve(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024,
    }).trimEnd();
  } catch (cause) { throw mutationFailure(operation, "git-private", cause, args.join(" ")); }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function durableReplace(path: string, bytes: string | Uint8Array, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const descriptor = openSync(temporary, "wx", mode);
    try { fchmodSync(descriptor, mode); writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally { rmSync(temporary, { force: true }); }
}

function acquireLease(root: string, mode: TraceLease["mode"], operation: string, create: boolean, reclaimPublication = true): Effect.Effect<TraceLease | undefined, TraceMutationError> {
  if (operation === "trace-recover" && reclaimPublication) {
    try { recoverPublicationLeaseSync(root); } catch (cause) { return Effect.fail(mutationFailure(operation, "lock", cause)); }
  }
  return acquireTraceLease(root, mode, operation, create).pipe(Effect.mapError((cause) => mutationFailure(operation, cause.phase === "git-private" ? "git-private" : cause.phase === "cleanup" ? "cleanup" : "lock", cause, cause.path)));
}

function releaseLease(lease: TraceLease, operation: string): Effect.Effect<void, TraceMutationError> {
  return releaseTraceLease(lease, operation).pipe(Effect.mapError((cause) => mutationFailure(operation, "cleanup", cause, cause.path)));
}

function withLease<A, E, R>(
  root: string,
  mode: TraceLease["mode"],
  operation: string,
  create: boolean,
  use: (lease: TraceLease | undefined) => Effect.Effect<A, E, R>,
  reclaimPublication = true,
): Effect.Effect<A, E | TraceMutationError | TraceRecoveryConflict | TraceRecoveryRequired, R> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function*() {
    if (operation === "trace-recover") {
      try {
        const generic = genericJournalPath(root);
        if (existsSync(generic)) throw new TraceRecoveryRequired({ path: generic, nextStep: "concord recover" });
        const directory = tracePrivateDirectorySync(root);
        readJournal(root, directory);
        readMultiJournal(root, directory);
      } catch (cause) {
        return yield* Effect.fail(cause instanceof TraceRecoveryConflict || cause instanceof TraceRecoveryRequired ? cause : mutationFailure(operation, "read", cause));
      }
    }
    const lease = yield* acquireLease(root, mode, operation, create, reclaimPublication);
    const useExit = yield* Effect.exit(restore(use(lease)));
    if (lease === undefined) {
      if (Exit.isFailure(useExit)) return yield* Effect.failCause(useExit.cause);
      return useExit.value;
    }
    const releaseExit = yield* Effect.exit(releaseLease(lease, operation));
    if (Exit.isFailure(releaseExit)) {
      if (Exit.isFailure(useExit)) return yield* Effect.failCause(Cause.combine(useExit.cause, releaseExit.cause));
      return yield* Effect.failCause(releaseExit.cause);
    }
    if (Exit.isFailure(useExit)) return yield* Effect.failCause(useExit.cause);
    return useExit.value;
  }));
}

function journalPath(directory: string): string { return resolve(directory, JOURNAL_FILE); }
function pendingRecovery(root: string, directory: string): { readonly path: string; readonly nextStep: "pnpm trace recover" | "concord recover" } | undefined {
  const trace = journalPath(directory);
  if (existsSync(trace)) return { path: trace, nextStep: "pnpm trace recover" };
  const multi = multiJournalPath(directory);
  if (existsSync(multi)) return { path: multi, nextStep: "pnpm trace recover" };
  const generic = genericJournalPath(root);
  return existsSync(generic) ? { path: generic, nextStep: "concord recover" } : undefined;
}

function identityPart(path: string): { readonly path: string; readonly device: string; readonly inode: string } {
  const canonical = realpathSync(path);
  const status = statSync(canonical);
  return { path: canonical, device: String(status.dev), inode: String(status.ino) };
}

function coordinationId(directory: string, create: boolean): string {
  const path = resolve(directory, COORDINATION_ID_FILE);
  if (!existsSync(path)) {
    if (!create) throw new Error("coordination identity is missing");
    durableReplace(path, `${randomUUID()}\n`, 0o600);
  }
  const value = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error("coordination identity is invalid");
  return value;
}

function worktreeIdentity(root: string, directory: string, create: boolean, operation: string): WorktreeIdentity {
  try {
    return {
      root: identityPart(resolve(root)),
      gitDir: identityPart(gitOutput(root, operation, ["rev-parse", "--path-format=absolute", "--git-dir"]).trim()),
      commonDir: identityPart(gitOutput(root, operation, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
      coordinationId: coordinationId(directory, create),
    };
  } catch (cause) {
    if (cause instanceof TraceMutationError) throw cause;
    throw mutationFailure(operation, "journal", cause, directory);
  }
}

function sameIdentity(left: WorktreeIdentity, right: WorktreeIdentity): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function headCommit(root: string, operation: string): string { return gitOutput(root, operation, ["rev-parse", "HEAD"]).trim(); }
function indexEntry(root: string, owner: string, operation: string): string | null {
  const output = gitOutput(root, operation, ["ls-files", "--stage", "--", owner]);
  return output.length === 0 ? null : output;
}

function readFileSnapshot(path: string, operation: string): FileSnapshot {
  try {
    if (!existsSync(path)) return { kind: "absent" };
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error("owner must be a regular, non-symlink file");
    if (status.size > MAXIMUM_OWNER_BYTES) throw mutationFailure(operation, "capacity", `owner exceeds ${MAXIMUM_OWNER_BYTES} bytes`, path);
    const bytes = readFileSync(path);
    return { kind: "file", bytes, digest: traceDigest(bytes), byteLength: bytes.byteLength, mode: status.mode & 0o7777 };
  } catch (cause) {
    if (cause instanceof TraceMutationError) throw cause;
    throw mutationFailure(operation, "read", cause, path);
  }
}

type SnapshotExpectation = FileJournal["preimage"] | FileJournal["planned"] | MultiFileJournalEntry["preimage"] | MultiFileJournalEntry["planned"];
function fileSnapshotMatches(snapshot: FileSnapshot, expected: SnapshotExpectation): boolean {
  if ("kind" in expected && expected.kind === "absent") return snapshot.kind === "absent";
  return snapshot.kind === "file" && snapshot.digest === expected.digest && snapshot.byteLength === expected.byteLength && snapshot.mode === expected.mode;
}

function preimageForJournal(snapshot: FileSnapshot): FileJournal["preimage"] {
  return snapshot.kind === "absent" ? { kind: "absent" } : {
    kind: "file", bytesBase64: snapshot.bytes.toString("base64"), digest: snapshot.digest, byteLength: snapshot.byteLength, mode: snapshot.mode,
  };
}

function manifest(root: string, operation: string): readonly ManifestEntry[] | undefined {
  if (!existsSync(root)) return undefined;
  const entries: ManifestEntry[] = [];
  const visit = (absolute: string, path: string): void => {
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw new Error(`${path}: symlink is forbidden`);
    if (status.isDirectory()) {
      entries.push({ kind: "directory", path, mode: status.mode & 0o7777 });
      for (const child of readdirSync(absolute).sort()) visit(resolve(absolute, child), path === "." ? child : `${path}/${child}`);
      return;
    }
    if (!status.isFile()) throw new Error(`${path}: special file is forbidden`);
    const bytes = readFileSync(absolute);
    entries.push({ kind: "file", path, mode: status.mode & 0o7777, byteLength: bytes.byteLength, digest: traceDigest(bytes) });
  };
  try { visit(root, "."); return entries.sort((left, right) => left.path.localeCompare(right.path)); }
  catch (cause) { throw mutationFailure(operation, "read", cause, root); }
}

function sameManifest(
  left: readonly TraceDirectoryManifestEntry[] | undefined,
  right: readonly TraceDirectoryManifestEntry[],
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
function manifestIsSubset(current: readonly ManifestEntry[] | undefined, planned: readonly ManifestEntry[]): boolean {
  if (current === undefined) return true;
  const expected = new Map(planned.map((entry) => [entry.path, entry]));
  return current.every((entry) => JSON.stringify(entry) === JSON.stringify(expected.get(entry.path)));
}

function validateJournal(root: string, directory: string, input: unknown): PublicationJournal {
  const decoded = Schema.decodeUnknownResult(JournalSchema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(decoded)) throw new TraceRecoveryConflict({ path: journalPath(directory), message: SchemaIssue.makeFormatterDefault()(decoded.failure.issue) });
  const journal = decoded.success;
  repositoryPath(root, journal.owner, "recover");
  if (journal.publication === "file-replace") {
    repositoryPath(root, journal.temporary, "recover");
    if (dirname(journal.temporary) !== dirname(journal.owner) || !basename(journal.temporary).includes(journal.token)) {
      throw new TraceRecoveryConflict({ path: journalPath(directory), message: "file temporary path does not belong to the owner transaction" });
    }
    if (journal.preimage.kind === "file") {
      const bytes = Buffer.from(journal.preimage.bytesBase64, "base64");
      if (bytes.byteLength !== journal.preimage.byteLength || traceDigest(bytes) !== journal.preimage.digest || bytes.byteLength > MAXIMUM_OWNER_BYTES) {
        throw new TraceRecoveryConflict({ path: journalPath(directory), message: "file preimage bytes do not match their receipt" });
      }
    }
  } else {
    const stage = repositoryPath(root, journal.stage, "recover");
    const target = repositoryPath(root, journal.target, "recover");
    const feedbackDirectory = journal.publication === "new-feedback-directory" &&
      /^feedback\/\.stage-[0-9a-f-]{36}$/u.test(journal.stage) &&
      /^feedback\/(?!\.)[^/]+$/u.test(journal.target);
    const docsDirectory = journal.publication === "new-docs-directory" &&
      /^docs\/feature\/\.stage-[0-9a-f-]{36}$/u.test(journal.stage) &&
      validPackagePath('feature', `${journal.target}/README.md`);
    if ((!feedbackDirectory && !docsDirectory) || journal.owner !== `${journal.target}/README.md` ||
      dirname(stage) !== dirname(target)) {
      throw new TraceRecoveryConflict({ path: journalPath(directory), message: "directory publication paths are invalid" });
    }
    const keys = journal.manifest.map((entry) => entry.path);
    if (journal.manifest[0]?.path !== "." || new Set(keys).size !== keys.length || journal.manifest.some((entry) =>
      entry.path !== "." && (entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")))) {
      throw new TraceRecoveryConflict({ path: journalPath(directory), message: "directory manifest paths are invalid" });
    }
  }
  return journal;
}

function readJournal(root: string, directory: string): PublicationJournal | undefined {
  const path = journalPath(directory);
  if (!existsSync(path)) return undefined;
  try { return validateJournal(root, directory, JSON.parse(readFileSync(path, "utf8")) as unknown); }
  catch (cause) {
    if (cause instanceof TraceRecoveryConflict) throw cause;
    throw new TraceRecoveryConflict({ path, message: message(cause) });
  }
}
function writeJournal(directory: string, journal: PublicationJournal): void { durableReplace(journalPath(directory), `${JSON.stringify(journal, null, 2)}\n`, 0o600); }
function removeJournal(directory: string): void { rmSync(journalPath(directory), { force: true }); fsyncDirectory(directory); }

function removeExactFile(path: string, expected: FileJournal["planned"], operation: string): void {
  const current = readFileSnapshot(path, operation);
  if (current.kind === "absent") return;
  if (!fileSnapshotMatches(current, expected)) throw new TraceRecoveryConflict({ path, message: "transaction temporary file changed" });
  rmSync(path);
  fsyncDirectory(dirname(path));
}

function writePreparedFile(path: string, bytes: Buffer, mode: number): void {
  const descriptor = openSync(path, "wx", mode);
  try { fchmodSync(descriptor, mode); writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  fsyncDirectory(dirname(path));
}

function restoreFile(root: string, journal: FileJournal): void {
  const owner = repositoryPath(root, journal.owner, "recover");
  const temporary = repositoryPath(root, journal.temporary, "recover");
  if (journal.preimage.kind === "absent") { rmSync(owner); fsyncDirectory(dirname(owner)); return; }
  const bytes = Buffer.from(journal.preimage.bytesBase64, "base64");
  if (existsSync(temporary)) removeExactFile(temporary, journal.planned, "recover");
  writePreparedFile(temporary, bytes, journal.preimage.mode);
  if (!fileSnapshotMatches(readFileSnapshot(owner, "recover"), journal.planned)) {
    throw new TraceRecoveryConflict({ path: journal.owner, message: "owner changed immediately before rollback" });
  }
  renameSync(temporary, owner);
  fsyncDirectory(dirname(owner));
}

function discardStage(root: string, directory: string, journal: DirectoryJournal): void {
  const stage = repositoryPath(root, journal.stage, "recover");
  const target = repositoryPath(root, journal.target, "recover");
  if (existsSync(target)) throw new TraceRecoveryConflict({ path: journal.target, message: "target reappeared while discarding stage" });
  const current = manifest(stage, "recover");
  if (!manifestIsSubset(current, journal.manifest)) throw new TraceRecoveryConflict({ path: journal.stage, message: "discarding stage is not an exact remaining subset of its manifest" });
  if (current !== undefined) {
    const ordered = [...current].sort((left, right) => {
      const depth = right.path.split("/").length - left.path.split("/").length;
      if (depth !== 0) return depth;
      if (left.kind !== right.kind) return left.kind === "file" ? -1 : 1;
      return right.path.localeCompare(left.path);
    });
    for (const entry of ordered) {
      const absolute = entry.path === "." ? stage : resolve(stage, entry.path);
      const status = lstatSync(absolute);
      if (entry.kind === "file") {
        if (!status.isFile() || status.isSymbolicLink()) throw new TraceRecoveryConflict({ path: journal.stage, message: `${entry.path} changed while discarding` });
        const bytes = readFileSync(absolute);
        if ((status.mode & 0o7777) !== entry.mode || bytes.byteLength !== entry.byteLength || traceDigest(bytes) !== entry.digest) {
          throw new TraceRecoveryConflict({ path: journal.stage, message: `${entry.path} changed while discarding` });
        }
        rmSync(absolute);
      } else {
        if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o7777) !== entry.mode || readdirSync(absolute).length > 0) {
          throw new TraceRecoveryConflict({ path: journal.stage, message: `${entry.path} changed while discarding` });
        }
        rmdirSync(absolute);
      }
      fsyncDirectory(dirname(absolute));
    }
  }
  if (existsSync(stage)) throw new TraceRecoveryConflict({ path: journal.stage, message: "stage remained after exact discard" });
  fsyncDirectory(dirname(stage));
  removeJournal(directory);
}

function verifyRecoveryIdentity(root: string, directory: string, journal: PublicationJournal): void {
  if (journal.process.host !== hostname()) {
    throw new TraceRecoveryConflict({ path: journalPath(directory), message: "journal belongs to another host" });
  }
  if (!sameIdentity(worktreeIdentity(root, directory, false, "recover"), journal.identity)) {
    throw new TraceRecoveryConflict({ path: journalPath(directory), message: "worktree or Git identity changed while a journal was active" });
  }
}
function verifyRecoveryGit(root: string, journal: PublicationJournal): void {
  if (headCommit(root, "recover") !== journal.headCommit || indexEntry(root, journal.owner, "recover") !== journal.indexEntry) {
    throw new TraceRecoveryConflict({ path: journal.owner, message: "HEAD or owner Git index entry changed while a journal was active" });
  }
}

function recoverFileJournal(root: string, directory: string, journal: FileJournal): TraceRecoveryReceipt {
  verifyRecoveryIdentity(root, directory, journal);
  verifyRecoveryGit(root, journal);
  const owner = repositoryPath(root, journal.owner, "recover");
  const temporary = repositoryPath(root, journal.temporary, "recover");
  const ownerState = readFileSnapshot(owner, "recover");
  const temporaryState = readFileSnapshot(temporary, "recover");
  if (journal.phase === "committed") {
    if (!fileSnapshotMatches(ownerState, journal.planned) || temporaryState.kind !== "absent") throw new TraceRecoveryConflict({ path: journal.owner, message: "committed file publication no longer matches its journal" });
    removeJournal(directory);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "completed", owner: journal.owner };
  }
  if (fileSnapshotMatches(ownerState, journal.preimage)) {
    if (temporaryState.kind !== "absent") removeExactFile(temporary, journal.planned, "recover");
    removeJournal(directory);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "discarded-unpublished", owner: journal.owner };
  }
  if (fileSnapshotMatches(ownerState, journal.planned) && temporaryState.kind === "absent") {
    restoreFile(root, journal);
    removeJournal(directory);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "rolled-back", owner: journal.owner };
  }
  throw new TraceRecoveryConflict({ path: journal.owner, message: "file publication state does not match a safe recovery transition" });
}

function recoverDirectoryJournal(root: string, directory: string, journal: DirectoryJournal): TraceRecoveryReceipt {
  verifyRecoveryIdentity(root, directory, journal);
  verifyRecoveryGit(root, journal);
  const stage = repositoryPath(root, journal.stage, "recover");
  const target = repositoryPath(root, journal.target, "recover");
  if (journal.phase === "discarding-stage") {
      discardStage(root, directory, journal);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "finished-discard", owner: journal.owner };
  }
  const stageManifest = manifest(stage, "recover");
  const targetManifest = manifest(target, "recover");
  if (journal.phase === "committed") {
    if (stageManifest !== undefined || !sameManifest(targetManifest, journal.manifest)) throw new TraceRecoveryConflict({ path: journal.target, message: "committed directory publication no longer matches its journal" });
    removeJournal(directory);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "completed", owner: journal.owner };
  }
  if (sameManifest(stageManifest, journal.manifest) && targetManifest === undefined) {
    const discarding = { ...journal, phase: "discarding-stage" as const };
    writeJournal(directory, discarding);
    discardStage(root, directory, discarding);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "discarded-unpublished", owner: journal.owner };
  }
  if (stageManifest === undefined && sameManifest(targetManifest, journal.manifest)) {
    if (existsSync(stage)) throw new TraceRecoveryConflict({ path: journal.stage, message: "stage appeared immediately before rollback" });
    renameSync(target, stage);
    fsyncDirectory(dirname(target));
    const discarding = { ...journal, phase: "discarding-stage" as const };
    writeJournal(directory, discarding);
    discardStage(root, directory, discarding);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "rolled-back", owner: journal.owner };
  }
  throw new TraceRecoveryConflict({ path: journal.target, message: "directory publication state does not match a safe recovery transition" });
}

function recoverUnderLease(root: string, directory: string): TraceRecoveryReceipt {
  const journal = readJournal(root, directory);
  if (journal === undefined) return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: false, action: "none" };
  invalidateActiveRun(root);
  return journal.publication === "file-replace" ? recoverFileJournal(root, directory, journal) : recoverDirectoryJournal(root, directory, journal);
}

export function recoverTrace(root: string, options: { readonly reclaimPublication?: boolean } = {}): Effect.Effect<TraceRecoveryReceipt, TraceCoordinationError> {
  return withLease(root, "exclusive", "trace-recover", true, (lease) => Effect.try({
    try: () => {
      if (lease === undefined) throw new Error("exclusive Trace lease was not created");
      worktreeIdentity(root, lease.directory, true, "trace-recover");
      const genericPath = genericJournalPath(root);
      if (existsSync(genericPath)) throw new TraceRecoveryRequired({ path: genericPath, nextStep: "concord recover" });
      if (existsSync(journalPath(lease.directory)) && existsSync(multiJournalPath(lease.directory))) throw new TraceRecoveryConflict({ path: lease.directory, message: "Multiple publication journals exist; preserve the conflicting recovery state" });
      const single = recoverUnderLease(root, lease.directory);
      return single.recovered ? single : recoverMultiUnderLease(root, lease.directory);
    },
    catch: (cause) => cause instanceof TraceMutationError || cause instanceof TraceRecoveryConflict || cause instanceof TraceRecoveryRequired ? cause : mutationFailure("trace-recover", "rollback", cause),
  }), options.reclaimPublication !== false);
}

const MULTI_FILE_JOURNAL = "multi-file-publication-journal.json";

export interface TraceMultiFileChange {
  readonly path: string;
  readonly bytes: string | Uint8Array | null;
  readonly mode?: number;
  readonly expectedDigest?: string | null;
}
export interface TraceMultiFileReceipt {
  readonly format: "concord.docs-trace/multi-file-mutation/v1";
  readonly transactionId: string;
  readonly preimages: readonly { readonly path: string; readonly digest: string | null }[];
  readonly plannedDigests: readonly { readonly path: string; readonly digest: string | null }[];
  readonly committed: true;
}
export interface TraceMultiFileOptions<E = never, R = never> {
  readonly root: string;
  readonly operation: string;
  /**
   * Builds the publication while the exclusive Trace lease is held.  A case
   * relation's dependencies are not just its output sidecar, so callers that
   * validate Trace or remote state must use this instead of validating first
   * and handing us a stale array of changes.
   */
  readonly prepareUnderLease?: Effect.Effect<readonly TraceMultiFileChange[], E, R>;
  readonly changes?: readonly TraceMultiFileChange[];
  readonly injectFailureAfterRename?: number;
  readonly injectFailureAfterCommit?: boolean;
}
interface MultiFileJournalEntry {
  readonly path: string;
  readonly temporary: string;
  readonly preimage: { readonly kind: "absent" } | { readonly kind: "file"; readonly bytesBase64: string; readonly digest: string; readonly byteLength: number; readonly mode: number };
  readonly planned: { readonly kind: "absent" } | { readonly kind: "file"; readonly digest: string; readonly byteLength: number; readonly mode: number };
}
interface MultiFileJournalV2 {
  readonly format: "concord.trace/multi-file-publication-journal/v1";
  readonly phase: "prepared" | "publishing" | "committed" | "cleanup";
  readonly transactionId: string;
  readonly operation: string;
  readonly headCommit: string;
  readonly indexEntries: Readonly<Record<string, string | null>>;
  readonly identity: WorktreeIdentity;
  readonly files: readonly MultiFileJournalEntry[];
}

const MultiPreimageSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({ kind: Schema.Literal("file"), bytesBase64: Schema.String, digest: DigestSchema, byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), mode: ModeSchema }),
]);
const MultiPlannedSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({ kind: Schema.Literal("file"), digest: DigestSchema, byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), mode: ModeSchema }),
]);
const MultiFileEntrySchema = Schema.Struct({ path: NonEmptyTrimmedString, temporary: NonEmptyTrimmedString, preimage: MultiPreimageSchema, planned: MultiPlannedSchema });
const MultiJournalSchema = Schema.Struct({
  format: Schema.Literal("concord.trace/multi-file-publication-journal/v1"),
  phase: Schema.Literals(["prepared", "publishing", "committed", "cleanup"]),
  transactionId: Schema.String.check(Schema.isPattern(/^netxn_[0-9a-f]+$/u)), operation: NonEmptyTrimmedString,
  headCommit: NonEmptyTrimmedString,
  indexEntries: Schema.Record(Schema.String, Schema.NullOr(Schema.String)), identity: WorktreeIdentitySchema,
  files: Schema.Array(MultiFileEntrySchema).pipe(Schema.check(Schema.isMinLength(1))),
});

function multiJournalPath(directory: string): string { return resolve(directory, MULTI_FILE_JOURNAL); }
function validateMultiJournal(root: string, directory: string, input: unknown): MultiFileJournalV2 {
  const path = multiJournalPath(directory);
  const decoded = Schema.decodeUnknownResult(MultiJournalSchema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(decoded)) throw new TraceRecoveryConflict({ path, message: SchemaIssue.makeFormatterDefault()(decoded.failure.issue) });
  const journal = decoded.success;
  const keys = Object.keys(journal.indexEntries);
  const paths = journal.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || keys.length !== paths.length || keys.some((key) => !paths.includes(key))) throw new TraceRecoveryConflict({ path, message: "journal index entries and files differ" });
  const owners = new Set(paths);
  const temporaries = new Set<string>();
  for (const file of journal.files) {
    repositoryPath(root, file.path, "multi-file-recover");
    repositoryPath(root, file.temporary, "multi-file-recover");
    const expectedTemporary = slash(join(dirname(file.path), `.${basename(file.path)}.concord-${journal.transactionId}.tmp`));
    if (file.temporary !== expectedTemporary || temporaries.has(file.temporary) || owners.has(file.temporary)) throw new TraceRecoveryConflict({ path, message: `temporary path is not exactly owned by ${journal.transactionId}` });
    temporaries.add(file.temporary);
    const checkMode = (mode: number): void => { if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new TraceRecoveryConflict({ path, message: `invalid mode for ${file.path}` }); };
    if (file.preimage.kind === "file") {
      if (file.preimage.byteLength > MAXIMUM_OWNER_BYTES) throw new TraceRecoveryConflict({ path, message: `preimage exceeds ${MAXIMUM_OWNER_BYTES} bytes` });
      const bytes = Buffer.from(file.preimage.bytesBase64, "base64");
      if (bytes.byteLength !== file.preimage.byteLength || bytes.toString("base64") !== file.preimage.bytesBase64 || traceDigest(bytes) !== file.preimage.digest) throw new TraceRecoveryConflict({ path, message: `preimage does not match ${file.path}` });
      checkMode(file.preimage.mode);
    }
    if (file.planned.kind === "file") { if (file.planned.byteLength > MAXIMUM_OWNER_BYTES) throw new TraceRecoveryConflict({ path, message: `planned file exceeds ${MAXIMUM_OWNER_BYTES} bytes` }); checkMode(file.planned.mode); }
  }
  return journal;
}
function writeMultiJournal(root: string, directory: string, journal: MultiFileJournalV2): void {
  const validated = validateMultiJournal(root, directory, journal);
  durableReplace(multiJournalPath(directory), `${JSON.stringify(validated)}\n`, 0o600);
}
function readMultiJournal(root: string, directory: string): MultiFileJournalV2 | undefined {
  const path = multiJournalPath(directory);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch (cause) { throw new TraceRecoveryConflict({ path, message: `invalid multi-file journal: ${message(cause)}` }); }
  return validateMultiJournal(root, directory, value);
}
function removeMultiJournal(directory: string): void { rmSync(multiJournalPath(directory), { force: true }); fsyncDirectory(directory); }
function assertMultiGit(root: string, journal: MultiFileJournalV2): void {
  if (headCommit(root, "multi-file-recover") !== journal.headCommit || journal.files.some((file) => indexEntry(root, file.path, "multi-file-recover") !== journal.indexEntries[file.path])) {
    throw new TraceRecoveryConflict({ path: multiJournalPath(root), message: "HEAD or Git index changed while multi-file journal was active" });
  }
}
function restoreMultiPreimages(root: string, journal: MultiFileJournalV2): void {
  for (const file of journal.files) {
    const target = repositoryPath(root, file.path, journal.operation);
    const state = readFileSnapshot(target, journal.operation);
    if (!fileSnapshotMatches(state, file.preimage) && !fileSnapshotMatches(state, file.planned)) throw new TraceRecoveryConflict({ path: file.path, message: "file is neither its recorded preimage nor planned image" });
    const temporary = repositoryPath(root, file.temporary, journal.operation);
    const temporaryState = readFileSnapshot(temporary, journal.operation);
    if (file.planned.kind === "absent") {
      if (temporaryState.kind !== "absent") throw new TraceRecoveryConflict({ path: file.temporary, message: "temporary exists for an absent planned image" });
    } else if (temporaryState.kind !== "absent" && !fileSnapshotMatches(temporaryState, file.planned)) {
      throw new TraceRecoveryConflict({ path: file.temporary, message: "temporary is neither absent nor its planned image" });
    }
  }
  for (const file of journal.files) {
    const target = repositoryPath(root, file.path, journal.operation);
    if (file.preimage.kind === "absent") {
      if (existsSync(target)) { rmSync(target); fsyncDirectory(dirname(target)); }
    } else if (!fileSnapshotMatches(readFileSnapshot(target, journal.operation), file.preimage)) {
      durableReplace(target, Buffer.from(file.preimage.bytesBase64, "base64"), file.preimage.mode);
    }
    const temporary = repositoryPath(root, file.temporary, journal.operation);
    if (existsSync(temporary) && file.planned.kind === "file") removeExactFile(temporary, file.planned, journal.operation);
    else if (existsSync(temporary)) throw new TraceRecoveryConflict({ path: file.temporary, message: "unexpected temporary file for an absent planned image" });
  }
}
function recoverMultiUnderLease(root: string, directory: string): TraceRecoveryReceipt {
  const journal = readMultiJournal(root, directory);
  if (journal === undefined) return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: false, action: "none" };
  if (!sameIdentity(worktreeIdentity(root, directory, false, "multi-file-recover"), journal.identity)) throw new TraceRecoveryConflict({ path: multiJournalPath(directory), message: "worktree identity changed" });
  assertMultiGit(root, journal);
  if (journal.phase === "committed" || journal.phase === "cleanup") {
    for (const file of journal.files) {
      if (!fileSnapshotMatches(readFileSnapshot(repositoryPath(root, file.path, journal.operation), journal.operation), file.planned)) throw new TraceRecoveryConflict({ path: file.path, message: "committed planned digest changed" });
      if (existsSync(repositoryPath(root, file.temporary, journal.operation))) throw new TraceRecoveryConflict({ path: file.temporary, message: "committed temporary file remains" });
    }
    removeMultiJournal(directory);
    return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "completed" };
  }
  invalidateActiveRun(root);
  restoreMultiPreimages(root, journal);
  removeMultiJournal(directory);
  return { format: "concord.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "rolled-back" };
}

export function recoverTraceMultiFile(root: string): Effect.Effect<TraceRecoveryReceipt, TraceCoordinationError> {
  return withLease(root, "exclusive", "trace-recover", true, (lease) => Effect.try({
    try: () => {
      if (lease === undefined) throw new Error("exclusive Trace lease was not created");
      const genericPath = genericJournalPath(root);
      if (existsSync(genericPath)) throw new TraceRecoveryRequired({ path: genericPath, nextStep: "concord recover" });
      if (existsSync(journalPath(lease.directory))) throw new TraceRecoveryRequired({ path: journalPath(lease.directory), nextStep: "concord recover" });
      return recoverMultiUnderLease(root, lease.directory);
    },
    catch: (cause) => cause instanceof TraceRecoveryConflict || cause instanceof TraceMutationError || cause instanceof TraceRecoveryRequired ? cause : mutationFailure("trace-recover", "rollback", cause),
  }));
}

export function mutateTraceFiles<E, R>(options: TraceMultiFileOptions<E, R>): Effect.Effect<TraceMultiFileReceipt, E | TraceCoordinationError, R> {
  return withLease(options.root, "exclusive", options.operation, true, (lease) => Effect.gen(function*() {
    let committed: MultiFileJournalV2 | undefined;
    let receipt: TraceMultiFileReceipt | undefined;
    try {
      if (lease === undefined) throw new Error("exclusive Trace lease was not created");
      const pending = pendingRecovery(options.root, lease.directory);
      if (pending !== undefined) throw new TraceRecoveryRequired(pending);
      invalidateActiveRun(options.root);
      const changes = options.prepareUnderLease === undefined ? options.changes : yield* options.prepareUnderLease;
      if (changes === undefined || changes.length === 0 || new Set(changes.map((change) => change.path)).size !== changes.length) throw mutationFailure(options.operation, "preimage", "changes must be non-empty and path-unique");
      const head = headCommit(options.root, options.operation);
      const token = `netxn_${randomUUID().replaceAll("-", "")}`;
      const files = changes.map((change): MultiFileJournalEntry => {
        const target = repositoryPath(options.root, change.path, options.operation);
        const source = readFileSnapshot(target, options.operation);
        const expected = change.expectedDigest;
        if (expected !== undefined && (source.kind === "absent" ? null : source.digest) !== expected) throw mutationFailure(options.operation, "preimage", "expected preimage digest changed", change.path);
        const bytes = change.bytes === null ? null : Buffer.from(change.bytes);
        const temporary = slash(relative(resolve(options.root), resolve(dirname(target), `.${basename(target)}.concord-${token}.tmp`)));
        return { path: change.path, temporary, preimage: preimageForJournal(source), planned: bytes === null ? { kind: "absent" as const } : { kind: "file" as const, digest: traceDigest(bytes), byteLength: bytes.byteLength, mode: change.mode ?? (source.kind === "file" ? source.mode : 0o644) } };
      });
      const journal: MultiFileJournalV2 = { format: "concord.trace/multi-file-publication-journal/v1", phase: "prepared", transactionId: token, operation: options.operation, headCommit: head, indexEntries: Object.fromEntries(files.map((file) => [file.path, indexEntry(options.root, file.path, options.operation)])), identity: worktreeIdentity(options.root, lease.directory, true, options.operation), files };
      receipt = { format: "concord.docs-trace/multi-file-mutation/v1", transactionId: token, preimages: files.map(file => ({ path: file.path, digest: file.preimage.kind === "absent" ? null : file.preimage.digest })), plannedDigests: files.map(file => ({ path: file.path, digest: file.planned.kind === "absent" ? null : file.planned.digest })), committed: true };
      invalidateActiveRun(options.root);
      writeMultiJournal(options.root, lease.directory, journal);
      files.forEach((file, index) => {
        if (file.planned.kind === "file") {
          const temporary = repositoryPath(options.root, file.temporary, options.operation);
          mkdirSync(dirname(temporary), { recursive: true });
          writePreparedFile(temporary, Buffer.from(changes[index]!.bytes!), file.planned.mode);
        }
      });
      writeMultiJournal(options.root, lease.directory, { ...journal, phase: "publishing" });
      assertMultiGit(options.root, journal);
      files.forEach((file, index) => {
        const target = repositoryPath(options.root, file.path, options.operation);
        if (!fileSnapshotMatches(readFileSnapshot(target, options.operation), file.preimage)) throw mutationFailure(options.operation, "preimage", "preimage changed before publish", file.path);
        if (file.planned.kind === "absent") {
          rmSync(target, { force: true });
          fsyncDirectory(dirname(target));
        } else {
          renameSync(repositoryPath(options.root, file.temporary, options.operation), target);
          fsyncDirectory(dirname(target));
        }
        if (options.injectFailureAfterRename === index + 1) throw mutationFailure(options.operation, "publish", "injected interruption", file.path);
      });
      writeMultiJournal(options.root, lease.directory, { ...journal, phase: "committed" });
      committed = { ...journal, phase: "committed" };
      if (options.injectFailureAfterCommit === true) throw mutationFailure(options.operation, "cleanup", "injected interruption");
      writeMultiJournal(options.root, lease.directory, { ...journal, phase: "cleanup" });
      removeMultiJournal(lease.directory);
      return receipt;
    } catch (cause) {
      if (committed && receipt && lease && !options.injectFailureAfterCommit) {
        try {
          if (!sameIdentity(worktreeIdentity(options.root, lease.directory, false, options.operation), committed.identity)) throw new TraceRecoveryConflict({ path: lease.directory, message: "worktree identity changed during cleanup" });
          assertMultiGit(options.root, committed);
          for (const file of committed.files) {
            if (!fileSnapshotMatches(readFileSnapshot(repositoryPath(options.root, file.path, options.operation), options.operation), file.planned) || existsSync(repositoryPath(options.root, file.temporary, options.operation))) throw new TraceRecoveryConflict({ path: file.path, message: "committed planned image changed during cleanup" });
          }
          removeMultiJournal(lease.directory);
          return receipt;
        } catch (recoveryCause) { return yield* Effect.fail(recoveryCause instanceof TraceRecoveryConflict ? recoveryCause : mutationFailure(options.operation, 'cleanup', recoveryCause)); }
      }
      return yield* Effect.fail(cause instanceof TraceMutationError || cause instanceof TraceRecoveryConflict || cause instanceof TraceRecoveryRequired ? cause : mutationFailure(options.operation, "publish", cause));
    }
  }));
}
