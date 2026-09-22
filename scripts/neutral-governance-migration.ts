import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import { parseDocument, stringify } from "yaml";

import {
  acquireCoordinationMigrationLeasesSync,
  genericJournalPath,
  genericPrivateDirectorySync,
  legacyTracePrivateDirectorySync,
  releaseCoordinationMigrationLeasesSync,
  tracePrivateDirectorySync,
  type CoordinationMigrationLeases,
} from "../src/coordination.js";
import { parseTypeScriptConfig } from "../src/config.js";
import { ConcordError, GitCommit, MemorySchema, Sha256, Slug, Text, decode, digest, type MemoryMeta } from "../src/shared.js";
import { NativeEvidenceEntrySchema } from "../src/evidence-policy.js";

const CONFIG_PATH = "concord.repository.json";
const MIGRATION_JOURNAL = "neutral-governance-migration-journal.json";
const TRACE_JOURNALS = ["publication-journal.json", "multi-file-publication-journal.json"] as const;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const CanonicalPath = Text.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[\\\0\r\n#])[^/]+(?:\/[^/]+)*$/u));
const Mode = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0o7777 }));
const SuiteSchema = Schema.Struct({ id: Slug, root: CanonicalPath });
const RepositoryV1Schema = Schema.Struct({ format: Schema.Literal("concord.repository/v1"), host: CanonicalPath });
const RepositoryV2Schema = Schema.Struct({
  format: Schema.Literal("concord.repository/v2"),
  suites: Schema.NonEmptyArray(SuiteSchema),
  historyPath: CanonicalPath,
  policy: Schema.Literal("concord.native-reliability/v1"),
  host: Schema.optional(CanonicalPath),
});
const StateDirectorySchema = Schema.Struct({ path: CanonicalPath, mode: Mode });
const StateFileSchema = Schema.Struct({ path: CanonicalPath, mode: Mode, bytesBase64: Schema.String, digest: Sha256 });
const RepositoryChangeSchema = Schema.Struct({ path: CanonicalPath, before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String), beforeDigest: Schema.NullOr(Sha256), afterDigest: Schema.NullOr(Sha256), mode: Mode });
const EvidenceIndexHistorySchema = Schema.Union([
  Schema.Struct({ caseId: Text, memory: CanonicalPath, evidence: NativeEvidenceEntrySchema, reason: Text, refreshedAtCommit: Text }),
  Schema.Struct({ caseId: Text, memory: CanonicalPath, evidence: NativeEvidenceEntrySchema, reason: Text, retiredAtCommit: Text }),
]);
const LegacyEvidenceIndexSchema = Schema.Struct({ format: Schema.Literal("niceeval.e2e-case-evidence-index/v1"), current: Schema.Record(Schema.String, Schema.Record(CanonicalPath, NativeEvidenceEntrySchema)), history: Schema.optional(Schema.Array(EvidenceIndexHistorySchema)) });
const CurrentEvidenceIndexSchema = Schema.Struct({ format: Schema.Literal("concord.case-evidence-index/v1"), current: Schema.Record(Schema.String, Schema.Record(CanonicalPath, NativeEvidenceEntrySchema)), history: Schema.optional(Schema.Array(EvidenceIndexHistorySchema)) });

export const NeutralGovernanceMigrationPlanSchema = Schema.Struct({
  format: Schema.Literal("concord.neutral-governance-migration-plan/v1"),
  mode: Schema.Literals(["governance", "coordination-only"]),
  root: Text,
  head: GitCommit,
  generatedAt: Text,
  repositoryChanges: Schema.Array(RepositoryChangeSchema),
  legacyState: Schema.Struct({ directories: Schema.Array(StateDirectorySchema), files: Schema.Array(StateFileSchema) }),
  operatorChecks: Schema.Struct({ legacyEntrypointsStopped: Schema.Literal(true), restartPreventionExternal: Schema.Literal(true) }),
});
export type NeutralGovernanceMigrationPlan = typeof NeutralGovernanceMigrationPlanSchema.Type;

const MigrationJournalSchema = Schema.Struct({
  format: Schema.Literal("concord.neutral-governance-migration-journal/v1"),
  transactionId: Text,
  phase: Schema.Literals(["prepared", "committed"]),
  plan: NeutralGovernanceMigrationPlanSchema,
});
type MigrationJournal = typeof MigrationJournalSchema.Type;

export interface NeutralGovernanceMigrationInput {
  readonly root: string;
  readonly mode?: "governance" | "coordination-only";
  readonly suites?: readonly { readonly id: string; readonly root: string }[];
  readonly historyPath?: string;
  readonly generatedAt: string;
}

export interface NeutralGovernanceMigrationOptions {
  readonly injectFailureAfterMutation?: number;
}

export interface NeutralGovernanceMigrationReceipt {
  readonly format: "concord.neutral-governance-migration-receipt/v1";
  readonly status: "applied" | "already-applied" | "rolled-back" | "committed" | "clean";
  readonly changedPaths: readonly string[];
  readonly stateFiles: number;
}

const asError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause));
const exists = (path: string): boolean => {
  try { lstatSync(path); return true; }
  catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false; throw cause; }
};

function git(root: string, args: readonly string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }).trim();
}

function canonicalRoot(input: string): string {
  const root = resolve(input);
  if (root !== input || git(root, ["rev-parse", "--show-toplevel"]) !== root) throw new ConcordError("MigrationRootInvalid", "Migration root must be the canonical Git worktree root");
  return root;
}

function canonicalRelative(path: string, label: string): string {
  const value = decode(CanonicalPath, path, label);
  if (isAbsolute(value)) throw new ConcordError("MigrationUnsafePath", `${label}: absolute paths are forbidden`);
  return value;
}

function repositoryTarget(root: string, path: string): string {
  const target = resolve(root, canonicalRelative(path, "migration path"));
  if (!target.startsWith(`${root}${sep}`)) throw new ConcordError("MigrationUnsafePath", path);
  let cursor = root;
  for (const part of path.split("/")) {
    cursor = join(cursor, part);
    if (exists(cursor) && lstatSync(cursor).isSymbolicLink()) throw new ConcordError("MigrationUnsafePath", `Symbolic links are forbidden: ${path}`);
  }
  return target;
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function durableWrite(path: string, bytes: string | Uint8Array, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.concord-migration.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", mode);
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (exists(temporary)) rmSync(temporary);
  }
}

function readRegular(path: string, label: string): { readonly bytes: Buffer; readonly mode: number } {
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || status.size > MAX_FILE_BYTES) throw new ConcordError("MigrationUnsafePath", `${label} must be a regular file no larger than ${MAX_FILE_BYTES} bytes`);
  return { bytes: readFileSync(path), mode: status.mode & 0o7777 };
}

function journalPath(root: string): string { return join(genericPrivateDirectorySync(root), MIGRATION_JOURNAL); }

function withMigrationLeases<A>(root: string, operation: string, use: (leases: CoordinationMigrationLeases) => A): A {
  let leases: CoordinationMigrationLeases | undefined;
  try {
    leases = acquireCoordinationMigrationLeasesSync(root, operation);
    return use(leases);
  } finally {
    if (leases !== undefined) releaseCoordinationMigrationLeasesSync(leases, operation);
  }
}

function assertNoPublicationJournal(root: string, legacy: string, current: string, allowMigrationJournal = false): void {
  const pending = [genericJournalPath(root), ...TRACE_JOURNALS.map(name => join(legacy, name)), ...TRACE_JOURNALS.map(name => join(current, name))];
  if (!allowMigrationJournal) pending.push(journalPath(root));
  const found = pending.find(exists);
  if (found !== undefined) throw new ConcordError("MigrationRecoveryRequired", `A publication or migration journal is pending at ${found}; preserve it and recover it before planning or applying`);
}

function assertExistingDirectory(root: string, path: string, label: string): void {
  const target = repositoryTarget(root, path);
  if (!exists(target) || !lstatSync(target).isDirectory()) throw new ConcordError("MigrationInputInvalid", `${label} must be an existing directory: ${path}`);
}

function assertSafeAncestors(root: string, path: string, label: string): void {
  let cursor = root;
  for (const part of path.split("/").slice(0, -1)) {
    cursor = join(cursor, part);
    if (!exists(cursor)) return;
    const status = lstatSync(cursor);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new ConcordError("MigrationInputInvalid", `${label} has an unsafe ancestor: ${path}`);
  }
}

function validateSuites(root: string, suites: readonly { readonly id: string; readonly root: string }[], historyPath: string): typeof RepositoryV2Schema.Type["suites"] {
  const decoded = suites.map((suite, index) => decode(SuiteSchema, suite, `suite ${index + 1}`));
  if (decoded.length === 0) throw new ConcordError("MigrationInputInvalid", "At least one explicit suite is required");
  if (new Set(decoded.map(suite => suite.id)).size !== decoded.length) throw new ConcordError("MigrationInputInvalid", "Suite IDs must be unique");
  for (const [index, suite] of decoded.entries()) {
    for (const other of decoded.slice(index + 1)) if (suite.root === other.root || suite.root.startsWith(`${other.root}/`) || other.root.startsWith(`${suite.root}/`)) {
      throw new ConcordError("MigrationInputInvalid", `Suite roots overlap: ${suite.root} and ${other.root}`);
    }
  }
  const history = canonicalRelative(historyPath, "historyPath");
  if (decoded.some(suite => history === suite.root || history.startsWith(`${suite.root}/`))) throw new ConcordError("MigrationInputInvalid", "historyPath must not be inside a suite root");
  for (const suite of decoded) assertExistingDirectory(root, suite.root, `suite ${suite.id}`);
  assertSafeAncestors(root, history, "historyPath");
  const first = decoded[0]!;
  return [first, ...decoded.slice(1)];
}

function splitMemory(source: string, path: string): { readonly metadata: MemoryMeta; readonly body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (match === null) throw new ConcordError("MigrationMemoryInvalid", `${path}: complete frontmatter is required`);
  const document = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
  if (document.errors.length > 0) throw new ConcordError("MigrationMemoryInvalid", `${path}: ${document.errors.map(error => error.message).join("; ")}`);
  return { metadata: decode(MemorySchema, document.toJS({ maxAliasCount: 0 }), path), body: match[2]! };
}

function memoryChanges(root: string): readonly typeof RepositoryChangeSchema.Type[] {
  const projectSource = readRegular(repositoryTarget(root, "concord.config.ts"), "concord.config.ts").bytes.toString("utf8");
  const project = parseTypeScriptConfig(projectSource);
  const roots = (project.memorySources ?? [{ path: "memory" }]).map(source => canonicalRelative(source.path, "memory source"));
  const paths: string[] = [];
  const visit = (absolute: string): void => {
    if (!exists(absolute)) return;
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw new ConcordError("MigrationUnsafePath", `Memory source contains a symbolic link: ${relative(root, absolute)}`);
    if (status.isFile()) { if (absolute.endsWith(".md") && basename(absolute) !== "README.md") paths.push(relative(root, absolute).split(sep).join("/")); return; }
    if (!status.isDirectory()) throw new ConcordError("MigrationUnsafePath", `Memory source contains a special file: ${relative(root, absolute)}`);
    for (const name of readdirSync(absolute).sort()) visit(join(absolute, name));
  };
  for (const path of roots) visit(repositoryTarget(root, path));
  return paths.sort().flatMap(path => {
    const before = readRegular(repositoryTarget(root, path), path).bytes.toString("utf8");
    // Navigation/supporting Markdown is not a Memory owner.
    if (!/^---(?:\r?\n|$)/u.test(before)) return [];
    const parsed = splitMemory(before, path);
    if (parsed.metadata.memoryKind !== "problem" || parsed.metadata.evidenceRequirement === "concord.native-reliability/v1") return [];
    const metadata = decode(MemorySchema, { ...parsed.metadata, evidenceRequirement: "concord.native-reliability/v1" }, `migrated ${path}`);
    const after = `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n${parsed.body}`;
    return [{ path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: lstatSync(repositoryTarget(root, path)).mode & 0o7777 }];
  });
}

function repositoryConfigChange(root: string, suites: readonly { readonly id: string; readonly root: string }[], historyPath: string): typeof RepositoryChangeSchema.Type {
  const path = repositoryTarget(root, CONFIG_PATH);
  const before = readRegular(path, CONFIG_PATH).bytes.toString("utf8");
  let input: unknown;
  try { input = JSON.parse(before); }
  catch (cause) { throw new ConcordError("MigrationConfigurationInvalid", asError(cause).message); }
  const legacy = decode(RepositoryV1Schema, input, CONFIG_PATH);
  const host = repositoryTarget(root, legacy.host);
  if (!exists(host) || !lstatSync(host).isFile()) throw new ConcordError("MigrationConfigurationInvalid", `Configured host must be an existing regular file: ${legacy.host}`);
  const config = decode(RepositoryV2Schema, { format: "concord.repository/v2", suites: validateSuites(root, suites, historyPath), historyPath, policy: "concord.native-reliability/v1", host: legacy.host }, "migrated repository configuration");
  const after = `${JSON.stringify(config, null, 2)}\n`;
  return { path: CONFIG_PATH, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: lstatSync(path).mode & 0o7777 };
}

function evidenceIndexChanges(root: string, suites: readonly { readonly id: string; readonly root: string }[], head: string): readonly typeof RepositoryChangeSchema.Type[] {
  const paths: string[] = [];
  const visit = (absolute: string): void => {
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw new ConcordError("MigrationUnsafePath", `Suite contains a symbolic link: ${relative(root, absolute)}`);
    if (status.isFile()) { if (absolute.endsWith(".cases.evidence.json")) paths.push(relative(root, absolute).split(sep).join("/")); return; }
    if (!status.isDirectory()) throw new ConcordError("MigrationUnsafePath", `Suite contains a special file: ${relative(root, absolute)}`);
    for (const name of readdirSync(absolute).sort()) visit(join(absolute, name));
  };
  for (const suite of suites) visit(repositoryTarget(root, suite.root));
  return paths.sort().flatMap(path => {
    const target = repositoryTarget(root, path);
    const before = readRegular(target, path).bytes.toString("utf8");
    let input: unknown;
    try { input = JSON.parse(before); }
    catch (cause) { throw new ConcordError("MigrationEvidenceIndexInvalid", `${path}: ${asError(cause).message}`); }
    if (typeof input === "object" && input !== null && "format" in input && input.format === "concord.case-evidence-index/v1") {
      decode(CurrentEvidenceIndexSchema, input, path);
      return [];
    }
    const legacy = decode(LegacyEvidenceIndexSchema, input, path);
    const archivedCurrent = Object.entries(legacy.current).flatMap(([caseId, memories]) => Object.entries(memories).map(([memory, evidence]) => ({
      caseId,
      memory,
      evidence,
      reason: "Archived during explicit neutral-governance migration; legacy evidence is historical and is not current proof.",
      retiredAtCommit: head,
    })));
    const migrated = decode(CurrentEvidenceIndexSchema, { format: "concord.case-evidence-index/v1", current: {}, history: [...(legacy.history ?? []), ...archivedCurrent] }, `migrated ${path}`);
    const after = `${JSON.stringify(migrated, null, 2)}\n`;
    const archivePath = `${path}.legacy.niceeval.e2e-case-evidence-index.v1.json`;
    if (exists(repositoryTarget(root, archivePath))) throw new ConcordError("MigrationEvidenceArchiveConflict", `${archivePath} already exists`);
    const mode = lstatSync(target).mode & 0o7777;
    return [
      { path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode },
      { path: archivePath, before: null, after: before, beforeDigest: null, afterDigest: digest(before), mode },
    ];
  });
}

function scanLegacyState(directory: string): NeutralGovernanceMigrationPlan["legacyState"] {
  const directories: Array<typeof StateDirectorySchema.Type> = [];
  const files: Array<typeof StateFileSchema.Type> = [];
  const visit = (absolute: string, path: string): void => {
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw new ConcordError("MigrationUnsafeState", `Legacy private state contains a symbolic link: ${path}`);
    if (status.isDirectory()) {
      if (path !== ".") directories.push({ path: canonicalRelative(path, "legacy state directory"), mode: status.mode & 0o7777 });
      for (const name of readdirSync(absolute).sort()) {
        if (path === "." && (name === "publication.lock" || name === "publication.lease" || name.startsWith(".publication.lease-"))) continue;
        visit(join(absolute, name), path === "." ? name : `${path}/${name}`);
      }
      return;
    }
    if (!status.isFile() || status.size > MAX_FILE_BYTES) throw new ConcordError("MigrationUnsafeState", `Legacy private state contains an unsupported file: ${path}`);
    const bytes = readFileSync(absolute);
    files.push({ path: canonicalRelative(path, "legacy state file"), mode: status.mode & 0o7777, bytesBase64: bytes.toString("base64"), digest: digest(bytes) });
  };
  if (exists(directory)) visit(directory, ".");
  return { directories, files };
}

function stateBytes(file: typeof StateFileSchema.Type): Buffer {
  const bytes = Buffer.from(file.bytesBase64, "base64");
  if (bytes.toString("base64") !== file.bytesBase64 || digest(bytes) !== file.digest || bytes.byteLength > MAX_FILE_BYTES) throw new ConcordError("MigrationPlanInvalid", `State preimage is invalid: ${file.path}`);
  return bytes;
}

function validatePlan(plan: NeutralGovernanceMigrationPlan): NeutralGovernanceMigrationPlan {
  const decoded = decode(NeutralGovernanceMigrationPlanSchema, plan, "neutral governance migration plan");
  canonicalRoot(decoded.root);
  if (new Set(decoded.repositoryChanges.map(change => change.path)).size !== decoded.repositoryChanges.length) throw new ConcordError("MigrationPlanInvalid", "Repository changes must be path-unique");
  if (decoded.mode === "coordination-only" && decoded.repositoryChanges.length !== 0) throw new ConcordError("MigrationPlanInvalid", "Coordination-only plans cannot change repository owners");
  if (decoded.mode === "governance" && decoded.repositoryChanges[0]?.path !== CONFIG_PATH) throw new ConcordError("MigrationPlanInvalid", "The first governance change must replace concord.repository.json");
  for (const change of decoded.repositoryChanges) {
    if ((change.before === null ? null : digest(change.before)) !== change.beforeDigest || (change.after === null ? null : digest(change.after)) !== change.afterDigest || change.after === null) throw new ConcordError("MigrationPlanInvalid", `Repository change digest mismatch or unsupported deletion: ${change.path}`);
  }
  const statePaths = [...decoded.legacyState.directories.map(entry => entry.path), ...decoded.legacyState.files.map(entry => entry.path)];
  if (new Set(statePaths).size !== statePaths.length) throw new ConcordError("MigrationPlanInvalid", "Legacy state paths must be unique");
  const reservedState = new Set<string>(["publication.lock", "publication.lease", ...TRACE_JOURNALS]);
  if (statePaths.some(path => reservedState.has(path))) throw new ConcordError("MigrationPlanInvalid", "Locks and pending publication journals cannot be migration payloads");
  const filePaths = new Set(decoded.legacyState.files.map(entry => entry.path));
  if (statePaths.some(path => path.split("/").slice(0, -1).some((_, index, parts) => filePaths.has(parts.slice(0, index + 1).join("/"))))) throw new ConcordError("MigrationPlanInvalid", "A state file cannot contain another planned path");
  for (const file of decoded.legacyState.files) stateBytes(file);
  return decoded;
}

function verifyDerivedPlan(plan: NeutralGovernanceMigrationPlan): void {
  if (plan.mode === "coordination-only") {
    if (plan.repositoryChanges.length !== 0) throw new ConcordError("MigrationPlanInvalid", "Coordination-only plans cannot change repository owners");
    return;
  }
  const plannedConfigSource = plan.repositoryChanges[0]?.after;
  if (plannedConfigSource === null || plannedConfigSource === undefined) throw new ConcordError("MigrationPlanInvalid", "Planned repository configuration is missing");
  let input: unknown;
  try { input = JSON.parse(plannedConfigSource); }
  catch (cause) { throw new ConcordError("MigrationPlanInvalid", `Planned repository configuration is invalid: ${asError(cause).message}`); }
  const config = decode(RepositoryV2Schema, input, "planned repository configuration");
  const expectedConfig = repositoryConfigChange(plan.root, config.suites, config.historyPath);
  const expected: NeutralGovernanceMigrationPlan["repositoryChanges"] = [expectedConfig, ...memoryChanges(plan.root), ...evidenceIndexChanges(plan.root, config.suites, plan.head)];
  if (JSON.stringify(expected) !== JSON.stringify(plan.repositoryChanges)) throw new ConcordError("MigrationPlanInvalid", "The reviewed plan does not exactly match the current migration rules and complete write scope");
}

function exactFile(path: string, bytes: Buffer, mode: number): boolean {
  if (!exists(path)) return false;
  const status = lstatSync(path);
  return status.isFile() && !status.isSymbolicLink() && (status.mode & 0o7777) === mode && readFileSync(path).equals(bytes);
}

function verifyPreparedPreimages(plan: NeutralGovernanceMigrationPlan, legacy: string, current: string): void {
  if (git(plan.root, ["rev-parse", "HEAD"]) !== plan.head) throw new ConcordError("MigrationHeadChanged", "HEAD changed since migration planning");
  for (const change of plan.repositoryChanges) {
    const target = repositoryTarget(plan.root, change.path);
    const current = exists(target) ? readRegular(target, change.path).bytes.toString("utf8") : null;
    if (current !== change.before) throw new ConcordError("MigrationPreimageChanged", `${change.path} changed since planning`);
  }
  const fresh = scanLegacyState(legacy);
  if (JSON.stringify(fresh) !== JSON.stringify(plan.legacyState)) throw new ConcordError("MigrationPreimageChanged", "Legacy private state changed since planning");
  for (const file of plan.legacyState.files) if (exists(join(current, file.path))) throw new ConcordError("MigrationPreimageChanged", `Current private state already owns ${file.path}`);
  for (const directory of plan.legacyState.directories) {
    const target = join(current, directory.path);
    if (exists(target) && (!lstatSync(target).isDirectory() || readdirSync(target).length > 0)) throw new ConcordError("MigrationPreimageChanged", `Current private state directory is not empty: ${directory.path}`);
  }
}

function planIsApplied(plan: NeutralGovernanceMigrationPlan, legacy: string, current: string): boolean {
  for (const change of plan.repositoryChanges) {
    const target = repositoryTarget(plan.root, change.path);
    const current = exists(target) ? readRegular(target, change.path).bytes.toString("utf8") : null;
    if (current !== change.after) return false;
  }
  const remainingLegacy = scanLegacyState(legacy);
  if (remainingLegacy.files.length > 0 || remainingLegacy.directories.length > 0) return false;
  if (!plan.legacyState.directories.every(directory => exists(join(current, directory.path)) && lstatSync(join(current, directory.path)).isDirectory())) return false;
  return plan.legacyState.files.every(file => exactFile(join(current, file.path), stateBytes(file), file.mode));
}

function writeMigrationJournal(root: string, journal: MigrationJournal): void {
  durableWrite(journalPath(root), `${JSON.stringify(journal, null, 2)}\n`, 0o600);
}

function readMigrationJournal(root: string): MigrationJournal | undefined {
  const path = journalPath(root);
  if (!exists(path)) return undefined;
  let input: unknown;
  try { input = JSON.parse(readRegular(path, path).bytes.toString("utf8")); }
  catch (cause) { throw new ConcordError("MigrationJournalInvalid", asError(cause).message); }
  return decode(MigrationJournalSchema, input, path);
}

function removeEmptyDirectories(root: string, directories: readonly { readonly path: string }[]): void {
  for (const directory of [...directories].sort((left, right) => right.path.length - left.path.length)) {
    const target = join(root, directory.path);
    if (exists(target)) {
      if (!lstatSync(target).isDirectory() || readdirSync(target).length > 0) throw new ConcordError("MigrationRecoveryConflict", `Directory contains unknown state: ${target}`);
      rmdirSync(target);
      syncDirectory(dirname(target));
    }
  }
}

function applyUnderLeases(plan: NeutralGovernanceMigrationPlan, leases: CoordinationMigrationLeases, options: NeutralGovernanceMigrationOptions): NeutralGovernanceMigrationReceipt {
  assertNoPublicationJournal(plan.root, leases.legacy.directory, leases.current.directory);
  if (planIsApplied(plan, leases.legacy.directory, leases.current.directory)) return { format: "concord.neutral-governance-migration-receipt/v1", status: "already-applied", changedPaths: plan.repositoryChanges.map(change => change.path), stateFiles: plan.legacyState.files.length };
  verifyDerivedPlan(plan);
  verifyPreparedPreimages(plan, leases.legacy.directory, leases.current.directory);
  const transactionId = `concord_migration_${randomUUID().replaceAll("-", "")}`;
  const journal: MigrationJournal = { format: "concord.neutral-governance-migration-journal/v1", transactionId, phase: "prepared", plan };
  writeMigrationJournal(plan.root, journal);
  let mutation = 0;
  const changed = (): void => {
    mutation += 1;
    if (options.injectFailureAfterMutation === mutation) throw new ConcordError("MigrationInterrupted", `Injected interruption after mutation ${mutation}`);
  };
  for (const change of plan.repositoryChanges) { durableWrite(repositoryTarget(plan.root, change.path), change.after!, change.mode); changed(); }
  for (const directory of plan.legacyState.directories) { mkdirSync(join(leases.current.directory, directory.path), { recursive: true, mode: directory.mode }); changed(); }
  for (const file of plan.legacyState.files) { durableWrite(join(leases.current.directory, file.path), stateBytes(file), file.mode); changed(); }
  for (const file of plan.legacyState.files) {
    const target = join(leases.legacy.directory, file.path);
    if (!exactFile(target, stateBytes(file), file.mode)) throw new ConcordError("MigrationPreimageChanged", `Legacy private state changed before removal: ${file.path}`);
    rmSync(target); syncDirectory(dirname(target)); changed();
  }
  removeEmptyDirectories(leases.legacy.directory, plan.legacyState.directories);
  writeMigrationJournal(plan.root, { ...journal, phase: "committed" });
  rmSync(journalPath(plan.root)); syncDirectory(genericPrivateDirectorySync(plan.root));
  return { format: "concord.neutral-governance-migration-receipt/v1", status: "applied", changedPaths: plan.repositoryChanges.map(change => change.path), stateFiles: plan.legacyState.files.length };
}

export const prepareNeutralGovernanceMigration = Effect.fn("prepareNeutralGovernanceMigration")(function*(input: NeutralGovernanceMigrationInput) {
  return yield* Effect.try({
    try: () => {
      const root = canonicalRoot(input.root);
      return withMigrationLeases(root, "prepare-neutral-governance-migration", leases => {
        assertNoPublicationJournal(root, leases.legacy.directory, leases.current.directory);
        const head = git(root, ["rev-parse", "HEAD"]);
        const mode = input.mode ?? "governance";
        let repositoryChanges: NeutralGovernanceMigrationPlan["repositoryChanges"] = [];
        if (mode === "governance") {
          if (input.suites === undefined || input.historyPath === undefined) throw new ConcordError("MigrationInputInvalid", "Governance migration requires explicit suites and historyPath");
          const historyPath = canonicalRelative(input.historyPath, "historyPath");
          const suites = validateSuites(root, input.suites, historyPath);
          const configChange = repositoryConfigChange(root, suites, historyPath);
          repositoryChanges = [configChange, ...memoryChanges(root), ...evidenceIndexChanges(root, suites, head)];
        } else if ((input.suites?.length ?? 0) > 0 || input.historyPath !== undefined) {
          throw new ConcordError("MigrationInputInvalid", "Coordination-only migration does not accept suites or historyPath");
        }
        return validatePlan({
          format: "concord.neutral-governance-migration-plan/v1",
          mode,
          root,
          head,
          generatedAt: input.generatedAt,
          repositoryChanges,
          legacyState: scanLegacyState(leases.legacy.directory),
          operatorChecks: { legacyEntrypointsStopped: true, restartPreventionExternal: true },
        });
      });
    },
    catch: asError,
  });
});

export const applyNeutralGovernanceMigration = Effect.fn("applyNeutralGovernanceMigration")(function*(input: NeutralGovernanceMigrationPlan, options: NeutralGovernanceMigrationOptions = {}) {
  return yield* Effect.try({
    try: () => {
      const plan = validatePlan(input);
      return withMigrationLeases(plan.root, "apply-neutral-governance-migration", leases => applyUnderLeases(plan, leases, options));
    },
    catch: asError,
  });
});

function recoveryState(plan: NeutralGovernanceMigrationPlan, legacy: string, current: string): void {
  for (const change of plan.repositoryChanges) {
    const target = repositoryTarget(plan.root, change.path);
    const source = exists(target) ? readRegular(target, change.path).bytes.toString("utf8") : null;
    if (source !== change.before && source !== change.after) throw new ConcordError("MigrationRecoveryConflict", `${change.path} contains an unknown edit`);
  }
  for (const file of plan.legacyState.files) {
    const bytes = stateBytes(file);
    const oldTarget = join(legacy, file.path);
    const newTarget = join(current, file.path);
    if (exists(oldTarget) && !exactFile(oldTarget, bytes, file.mode)) throw new ConcordError("MigrationRecoveryConflict", `Legacy state contains an unknown edit: ${file.path}`);
    if (exists(newTarget) && !exactFile(newTarget, bytes, file.mode)) throw new ConcordError("MigrationRecoveryConflict", `Current state contains an unknown edit: ${file.path}`);
    if (!exists(oldTarget) && !exists(newTarget)) throw new ConcordError("MigrationRecoveryConflict", `Both copies of state disappeared: ${file.path}`);
  }
}

function recoverUnderLeases(root: string, leases: CoordinationMigrationLeases): NeutralGovernanceMigrationReceipt {
  assertNoPublicationJournal(root, leases.legacy.directory, leases.current.directory, true);
  const journal = readMigrationJournal(root);
  if (journal === undefined) return { format: "concord.neutral-governance-migration-receipt/v1", status: "clean", changedPaths: [], stateFiles: 0 };
  const plan = validatePlan(journal.plan);
  if (plan.root !== root) throw new ConcordError("MigrationRecoveryConflict", "Migration journal belongs to another worktree");
  recoveryState(plan, leases.legacy.directory, leases.current.directory);
  if (journal.phase === "committed") {
    if (!planIsApplied(plan, leases.legacy.directory, leases.current.directory)) throw new ConcordError("MigrationRecoveryConflict", "Committed migration no longer matches its planned image");
    rmSync(journalPath(root)); syncDirectory(genericPrivateDirectorySync(root));
    return { format: "concord.neutral-governance-migration-receipt/v1", status: "committed", changedPaths: plan.repositoryChanges.map(change => change.path), stateFiles: plan.legacyState.files.length };
  }
  for (const file of plan.legacyState.files) {
    const bytes = stateBytes(file);
    const oldTarget = join(leases.legacy.directory, file.path);
    if (!exists(oldTarget)) durableWrite(oldTarget, bytes, file.mode);
  }
  for (const file of plan.legacyState.files) {
    const target = join(leases.current.directory, file.path);
    if (exists(target)) { rmSync(target); syncDirectory(dirname(target)); }
  }
  removeEmptyDirectories(leases.current.directory, plan.legacyState.directories);
  for (const change of [...plan.repositoryChanges].reverse()) {
    const target = repositoryTarget(root, change.path);
    const current = exists(target) ? readRegular(target, change.path).bytes.toString("utf8") : null;
    if (current === change.before) continue;
    if (change.before === null) { rmSync(target); syncDirectory(dirname(target)); }
    else durableWrite(target, change.before, change.mode);
  }
  rmSync(journalPath(root)); syncDirectory(genericPrivateDirectorySync(root));
  return { format: "concord.neutral-governance-migration-receipt/v1", status: "rolled-back", changedPaths: plan.repositoryChanges.map(change => change.path), stateFiles: plan.legacyState.files.length };
}

export const recoverNeutralGovernanceMigration = Effect.fn("recoverNeutralGovernanceMigration")(function*(inputRoot: string) {
  return yield* Effect.try({
    try: () => {
      const root = canonicalRoot(inputRoot);
      return withMigrationLeases(root, "recover-neutral-governance-migration", leases => recoverUnderLeases(root, leases));
    },
    catch: asError,
  });
});
