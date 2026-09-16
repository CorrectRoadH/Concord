import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { Effect, Option, Result } from "effect";
import { collectRepoCaseInventory, collectWorkspaceCaseInventory, managedInventoryImplementationDigest, readManagedInventoryReceipt, readManagedRedEvidence, readManagedTakeoverEvidence, type CaseInventoryReceipt, type WorkspaceInventoryReceipt } from "../../host.js";
import { REPOSITORY_ROOT } from "../runtime.js";
import { compileTrace, compileTraceUnderLease } from "../trace/index.js";
import { mutateTraceFiles, traceDigest } from "../trace/relation-mutation.js";
import { planCaseRelation, type CaseRelationAction } from "./planner.js";
import { parseCaseSelector, selectCurrentCase, type CaseSelector } from "./selector.js";
import { decodeCaseRelationsSidecar, encodeCaseRelationsSidecar, type CaseIssue, type CaseRelationsSidecar } from "./sidecar.js";
import { decodeAnnotatedCases, decodeCaseArchive, decodeCaseDeclarations, encodeCaseArchive, renderCaseAnnotations, type AnnotatedCase, type CaseDeclaration } from "./annotations.js";
import { resolveRepositorySourceIdentity, sameRepositorySourceIdentity, type RepositorySourceIdentityV3 } from "../../source-identity.js";

type Maybe<A> = Option.Option<A> | A | undefined;
interface InventoryCase { readonly executor: "vitest" | "playwright"; readonly repo: string; readonly path: string; readonly project?: string; readonly titlePath: readonly string[]; readonly caseId: string }
interface InventoryReceipt { readonly checkout: string; readonly repos: readonly { readonly id: string; readonly receipts: readonly unknown[] }[]; readonly digest: string; readonly findings: readonly string[]; readonly files: readonly string[]; readonly cases: readonly InventoryCase[]; readonly unassignedCases: readonly { readonly path: string; readonly project?: string; readonly titlePath: readonly string[] }[] }
interface MutationFlags { readonly dryRun: boolean }
export interface InventoryInput { readonly repo: string; readonly checkout: string }
export interface ListCasesInput { readonly pattern: Maybe<string>; readonly history: boolean; readonly inventory: Maybe<string> }
export interface ShowCaseInput { readonly selector: string; readonly history: boolean; readonly inventory: Maybe<string> }
export interface AuditCasesInput { readonly checkout: string }
export interface RetireCaseInput extends MutationFlags { readonly selector: string; readonly reason: string }
export interface AddRegressionInput extends MutationFlags { readonly selector: string; readonly memory: string; readonly red: string; readonly takeover: string; readonly inventory: string }
export interface RefreshRegressionInput extends AddRegressionInput { readonly reason: string }
export interface RetireRegressionInput extends MutationFlags { readonly selector: string; readonly memory: string; readonly reason: string }
export interface AddIssueInput extends MutationFlags { readonly selector: string; readonly url: string; readonly provenance: "direct"; readonly verificationReceipt: Maybe<string> }
export interface RetireIssueInput extends MutationFlags { readonly selector: string; readonly url: string; readonly reason: string }

export class CaseCliError extends Error { readonly name = "CaseCliError"; constructor(readonly code: string, message: string) { super(message); } }
const optional = <A>(value: Maybe<A>): A | undefined => Option.isOption(value) ? Option.getOrUndefined(value) : value;
const sha = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const signatureSha = (value: string): string => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const fail = (code: string, message: string): never => { throw new CaseCliError(code, message); };
const detail = (cause: unknown): string => typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string" ? cause.detail : cause instanceof Error ? cause.message : String(cause);
const sidecarPath = (testPath: string): string => `${testPath}.cases.json`;
const evidencePath = (testPath: string): string => `${testPath}.cases.evidence.json`;
const HISTORY_PATH = "e2e/concord-history.ts";
const absolute = (path: string): string => resolve(REPOSITORY_ROOT, path);
const read = (path: string): string => readFileSync(absolute(path), "utf8");
const emptySidecar = (testFile: string): CaseRelationsSidecar => ({ format: "niceeval.e2e-case-relations/v1", testFile, current: {}, history: [], tombstones: [] });
function sourceFiles(): readonly string[] {
  let output = "";
  try { output = execFileSync("rg", ["--files", "e2e", "-g", "*.ts", "-g", "*.tsx", "-g", "*.js", "-g", "*.jsx", "-g", "*.mts", "-g", "*.cts", "-g", "*.mjs", "-g", "*.cjs"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(); }
  catch (cause) { const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined; if (status !== 1) throw cause; }
  return output === "" ? [] : output.split("\n").filter((path) => path !== HISTORY_PATH).sort();
}
function annotatedCases(): readonly AnnotatedCase[] {
  const all: AnnotatedCase[] = [];
  for (const path of sourceFiles()) {
    const decoded = decodeAnnotatedCases(path, read(path));
    const found = Result.match(decoded, { onFailure: (error) => fail(error._tag, `${error.path}: ${error.message}`), onSuccess: (value) => value });
    all.push(...found);
  }
  const ids = new Map<string, string>();
  for (const item of all) { const previous = ids.get(item.caseId); if (previous !== undefined) fail("DuplicateCaseId", `${item.caseId} is declared by ${previous} and ${item.declarationPath}`); ids.set(item.caseId, item.declarationPath); }
  return all;
}
function caseDeclarations(): readonly CaseDeclaration[] {
  const all: CaseDeclaration[] = [];
  for (const path of sourceFiles()) {
    const decoded = decodeCaseDeclarations(path, read(path));
    all.push(...Result.match(decoded, { onFailure: (error) => fail(error._tag, `${error.path}: ${error.message}`), onSuccess: (value) => value }));
  }
  const ids = new Map<string, string>();
  for (const item of all) { const previous = ids.get(item.caseId); if (previous !== undefined) fail("DuplicateCaseId", `${item.caseId} is declared by ${previous} and ${item.declarationPath}`); ids.set(item.caseId, item.declarationPath); }
  return all;
}
function archive() {
  if (!existsSync(absolute(HISTORY_PATH))) return { history: [], tombstones: [] };
  const decoded = decodeCaseArchive(HISTORY_PATH, read(HISTORY_PATH));
  return Result.isSuccess(decoded) ? decoded.success : fail(decoded.failure._tag, `${decoded.failure.path}: ${decoded.failure.message}`);
}
const decodeSidecar = (path: string, allowAbsent = false): CaseRelationsSidecar => {
  const testFile = path.endsWith(".cases.json") ? path.slice(0, -".cases.json".length) : path;
  const current = Object.fromEntries(annotatedCases().filter((item) => item.testFile === testFile).map((item) => [item.caseId, { contract: item.contract, contractKind: item.contractKind, regressions: [...item.regressions], issues: [...item.issues] }]));
  const saved = archive();
  if (!allowAbsent && Object.keys(current).length === 0 && !saved.tombstones.some((entry) => entry.testFile === testFile)) fail("CaseNotCurrent", `no current or archived case owner exists for ${testFile}`);
  return { ...emptySidecar(testFile), current, history: saved.history.filter((entry) => entry.testFile === testFile).map((entry) => entry.event), tombstones: saved.tombstones.filter((entry) => entry.testFile === testFile).map((entry) => entry.event) };
};
const selector = (text: string): CaseSelector => { const parsed = parseCaseSelector(text); return Result.isSuccess(parsed) ? parsed.success : fail(parsed.failure._tag, `invalid case selector: ${text}`); };

const INVENTORY_ROOT = resolve(REPOSITORY_ROOT, ".repo-tools/test-inventories");
const INVENTORY_ID = /^neinv_[0-9A-HJKMNP-TV-Z]{16}$/;
interface StoredInventory { readonly inventoryId: string; readonly implementationDigest: string; readonly inventory: InventoryReceipt }

function inventoryImplementationDigest(): string {
  return managedInventoryImplementationDigest(REPOSITORY_ROOT);
}
function decodeInventory(value: Partial<InventoryReceipt> & Record<string, unknown>, source: string): InventoryReceipt {
  if (typeof value.checkout !== "string" || !Array.isArray(value.repos) || !Array.isArray(value.files) || !Array.isArray(value.cases) || !Array.isArray(value.unassignedCases) || !Array.isArray(value.findings) || typeof value.digest !== "string") fail("InventoryInvalid", `${source} is not a current managed inventory`);
  if (value.findings!.length > 0) fail("InventoryInvalid", `inventory has findings: ${value.findings!.join("; ")}`);
  const { digest, ...unsigned } = value;
  const actualDigest = sha(canonicalJson(unsigned));
  if (digest !== actualDigest) fail("InventoryInvalid", `${source} failed its integrity check; collect a fresh inventory`);
  return value as InventoryReceipt;
}
function inventoryFile(inventoryId: string): string {
  if (!INVENTORY_ID.test(inventoryId)) fail("InventoryInvalid", `${inventoryId} is not a managed inventory ID`);
  return resolve(INVENTORY_ROOT, `${inventoryId}.json`);
}
function parseInventory(inventoryId: string): InventoryReceipt {
  const path = inventoryFile(inventoryId);
  if (!existsSync(path)) fail("InventoryNotFound", `${inventoryId} is unavailable; collect a fresh inventory`);
  let stored: StoredInventory;
  try { stored = JSON.parse(readFileSync(path, "utf8")) as StoredInventory; }
  catch { return fail("InventoryInvalid", `${inventoryId} is unreadable; collect a fresh inventory`); }
  if (stored.inventoryId !== inventoryId || stored.implementationDigest !== inventoryImplementationDigest()) {
    fail("InventoryStale", `${inventoryId} was produced by a different implementation; collect a fresh inventory`);
  }
  return decodeInventory(stored.inventory as Partial<InventoryReceipt> & Record<string, unknown>, inventoryId);
}
function saveInventory(inventory: InventoryReceipt): string {
  const inventoryId = `neinv_${Array.from(randomBytes(16), (byte) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[byte & 31]).join("")}`;
  mkdirSync(INVENTORY_ROOT, { recursive: true, mode: 0o700 });
  writeFileSync(inventoryFile(inventoryId), `${JSON.stringify({ inventoryId, implementationDigest: inventoryImplementationDigest(), inventory })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return inventoryId;
}
const collectInventory = Effect.fn("collectInventory")(function*(action: InventoryInput) {
  const checkout = yield* Effect.try({
    try: () => execFileSync("git", ["rev-parse", action.checkout], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(),
    catch: (cause) => new CaseCliError("InventoryCheckoutInvalid", detail(cause)),
  });
  return yield* Effect.scoped(collectRepoCaseInventory(action.repo, checkout)).pipe(
    Effect.mapError((cause) => new CaseCliError("InventoryCollectionFailed", detail(cause))),
    Effect.map((inventory) => inventory as InventoryReceipt),
  );
});
function sidecarFiles(): readonly string[] {
  return [...new Set([...annotatedCases().map((item) => sidecarPath(item.testFile)), ...archive().tombstones.map((entry) => sidecarPath(entry.testFile))])].sort();
}
function inventoryForId(id: Maybe<string>): InventoryReceipt | undefined { const value = optional(id); return value === undefined ? undefined : parseInventory(value); }
function records(history: boolean, inventory?: InventoryReceipt) {
  const collected = new Map(inventory?.cases.map((item) => [`${item.path}#${item.caseId}`, item]));
  const declarations = annotatedCases();
  return sidecarFiles().flatMap((path) => { const sidecar = decodeSidecar(path); const digest = traceDigest(declarations.filter((item) => item.testFile === sidecar.testFile).map((item) => { const source = read(item.declarationPath); return item.annotationRanges.map((range) => source.slice(range.start, range.end)).join("\n"); }).join("\n")); return [
    ...Object.entries(sidecar.current).map(([caseId, relation]) => {
      const evidenceFile = evidencePath(sidecar.testFile);
      const evidence = existsSync(absolute(evidenceFile)) ? JSON.parse(read(evidenceFile)) as { current?: Record<string, unknown> } : undefined;
      return { selector: `${sidecar.testFile}#${caseId}`, sidecar: declarations.find((item) => item.caseId === caseId)!.declarationPath, digest, relation, evidence: evidence?.current?.[caseId] ?? {}, collected: collected?.get(`${sidecar.testFile}#${caseId}`) ?? null };
    }),
    ...(history ? sidecar.tombstones.map((entry) => ({ selector: entry.lastSelector, sidecar: HISTORY_PATH, digest, tombstone: entry })) : []),
  ]; });
}

function reconcileInventory(inventory: InventoryReceipt) {
  const inventoriedFiles = new Set(inventory.files);
  const current = records(false, inventory).filter((item) => inventoriedFiles.has(item.selector.slice(0, item.selector.lastIndexOf("#"))));
  const collected = new Map(inventory.cases.map((item) => [`${item.path}#${item.caseId}`, item]));
  const related = new Map(current.map((item) => [item.selector, item]));
  const findings = [
    ...inventory.cases.filter((item) => !related.has(`${item.path}#${item.caseId}`)).map((item) => ({ code: "MissingRelation", selector: `${item.path}#${item.caseId}` })),
    ...current.filter((item) => !collected.has(item.selector)).map((item) => ({ code: "CaseNotCollected", selector: item.selector })),
  ];
  const ids = new Map<string, string[]>();
  for (const item of inventory.cases) ids.set(item.caseId, [...(ids.get(item.caseId) ?? []), item.path]);
  findings.push(...[...ids].filter(([, paths]) => paths.length > 1).map(([caseId, paths]) => ({ code: "DuplicateCaseId", selector: `${caseId}: ${paths.join(", ")}` })));
  return { format: "niceeval.e2e-case-inventory-reconciliation/v1", inventory, cases: current, findings };
}

interface PlannedChange { readonly path: string; readonly bytes: string; readonly mode?: number; readonly expectedDigest: string | null }
function annotationProjectionChanges(pairs: readonly { readonly before: CaseRelationsSidecar; readonly next: CaseRelationsSidecar }[]): PlannedChange[] {
  const sources = new Map<string, string>();
  const expected = new Map<string, string>();
  const currentCases: CaseDeclaration[] = [];
  for (const path of sourceFiles()) {
    const source = read(path);
    sources.set(path, source);
    expected.set(path, traceDigest(source));
    const decoded = decodeCaseDeclarations(path, source);
    currentCases.push(...Result.match(decoded, { onFailure: (error) => fail(error._tag, `${error.path}: ${error.message}`), onSuccess: (value) => value }));
  }
  const edits = new Map<string, { readonly start: number; readonly end: number; readonly text: string }[]>();
  const addEdit = (path: string, start: number, end: number, text: string): void => {
    if (!sources.has(path)) { const source = read(path); sources.set(path, source); expected.set(path, traceDigest(source)); }
    edits.set(path, [...(edits.get(path) ?? []), { start, end, text }]);
  };
  const ids = new Set(pairs.flatMap(({ before, next }) => [...Object.keys(before.current), ...Object.keys(next.current)]));
  for (const caseId of ids) {
    const prior = pairs.find(({ before }) => before.current[caseId] !== undefined);
    const desired = pairs.find(({ next }) => next.current[caseId] !== undefined);
    const oldRelation = prior?.before.current[caseId]; const relation = desired?.next.current[caseId];
    const item = currentCases.find((entry) => entry.caseId === caseId);
    if (oldRelation !== undefined && (item === undefined || item.testFile !== prior!.before.testFile || JSON.stringify({ contract: item.contract, contractKind: item.contractKind, regressions: item.regressions, issues: item.issues }) !== JSON.stringify(oldRelation))) fail("PreimageChanged", `current annotation relation changed while planning ${prior!.before.testFile}#${caseId}`);
    if (relation !== undefined && item !== undefined && JSON.stringify(oldRelation) === JSON.stringify(relation) && item.testFile === desired!.next.testFile) {
      addEdit(item.declarationPath, 0, 0, "");
      continue;
    }
    if (relation === undefined) {
      const existing = item ?? fail("CaseNotCurrent", `${prior?.before.testFile ?? "<unknown>"}#${caseId}`);
      for (const range of existing.annotationRanges) addEdit(existing.declarationPath, range.start, range.end, "");
    } else if (item !== undefined) {
      const [first, ...rest] = item.annotationRanges;
      if (first === undefined) fail("CaseDeclarationAmbiguous", `${caseId} has no bound managed annotation ranges`);
      const originalLine = sources.get(item.declarationPath)!.slice(first!.start, first!.end);
      const ending = /\r\n$/u.test(originalLine) ? "\r\n" : /\n$/u.test(originalLine) ? "\n" : "";
      addEdit(item.declarationPath, first!.start, first!.end, `${renderCaseAnnotations(caseId, relation, item.declarationPath, desired!.next.testFile, item.annotationRanges.some(range => /^\s*\/\/\s*@test-file\b/u.test(sources.get(item.declarationPath)!.slice(range.start, range.end))))}${ending}`);
      for (const range of rest) addEdit(item.declarationPath, range.start, range.end, "");
    } else {
      fail("CaseNotCurrent", `${desired!.next.testFile}#${caseId}`);
    }
  }
  const changes: PlannedChange[] = [];
  for (const [path, fileEdits] of edits) {
    let bytes = sources.get(path)!;
    for (const edit of [...fileEdits].sort((a, b) => b.start - a.start)) bytes = bytes.slice(0, edit.start) + edit.text + bytes.slice(edit.end);
    changes.push({ path, bytes, expectedDigest: expected.get(path)! });
  }
  const saved = archive();
  const history = [...saved.history]; const tombstones = [...saved.tombstones];
  const historyKeys = new Set(history.map((entry) => JSON.stringify(entry)));
  const tombstoneKeys = new Set(tombstones.map((entry) => JSON.stringify(entry)));
  for (const { before, next } of pairs) {
    const capturedHistory = saved.history.filter((entry) => entry.testFile === before.testFile).map((entry) => entry.event);
    const capturedTombstones = saved.tombstones.filter((entry) => entry.testFile === before.testFile).map((entry) => entry.event);
    if (JSON.stringify(capturedHistory) !== JSON.stringify(before.history) || JSON.stringify(capturedTombstones) !== JSON.stringify(before.tombstones)) fail("PreimageChanged", `case archive changed while planning ${before.testFile}`);
    for (const event of next.history.slice(before.history.length)) {
      const entry = { testFile: next.testFile, event };
      const key = JSON.stringify(entry);
      if (!historyKeys.has(key)) { history.push(entry); historyKeys.add(key); }
    }
    for (const event of next.tombstones.filter((candidate) => !before.tombstones.some((entry) => entry.caseId === candidate.caseId))) {
      const entry = { testFile: next.testFile, event };
      const key = JSON.stringify(entry);
      if (!tombstoneKeys.has(key)) { tombstones.push(entry); tombstoneKeys.add(key); }
    }
  }
  if (history.length !== saved.history.length || tombstones.length !== saved.tombstones.length) {
    const bytes = encodeCaseArchive({ history, tombstones });
    changes.push({ path: HISTORY_PATH, bytes, expectedDigest: existsSync(absolute(HISTORY_PATH)) ? traceDigest(read(HISTORY_PATH)) : null });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
function transactionReceipt(operation: string, dryRun: boolean, changes: readonly PlannedChange[], value: unknown) {
  return { format: "niceeval.e2e-case-command/v1", operation, dryRun, transactionId: `netxn_plan_${randomUUID().replaceAll("-", "")}`, generationBefore: null, generationAfter: null, subject: value, preimages: changes.map((c) => ({ path: c.path, digest: c.expectedDigest })), plannedDigests: changes.map((c) => ({ path: c.path, digest: traceDigest(c.bytes) })), findings: [], committed: false };
}
interface PublicationPlan {
  readonly changes: readonly PlannedChange[];
  readonly value: unknown;
}
function publish<E, R>(
  operation: string,
  dryRun: boolean,
  prepareUnderLease: Effect.Effect<PublicationPlan, E, R>,
): Effect.Effect<unknown, E | import("../trace/relation-mutation.js").TraceCoordinationError, R> {
  const receipt = ({ changes, value }: PublicationPlan) => transactionReceipt(operation, dryRun, changes, value);
  if (dryRun) return prepareUnderLease.pipe(Effect.map(receipt));
  let prepared: PublicationPlan | undefined;
  return mutateTraceFiles({
    root: REPOSITORY_ROOT,
    operation,
    prepareUnderLease: prepareUnderLease.pipe(Effect.tap((value) => Effect.sync(() => { prepared = value; })), Effect.map(({ changes }) => changes)),
  }).pipe(Effect.map((mutation) => ({
    ...receipt(prepared!),
    transactionId: mutation.transactionId,
    generationBefore: mutation.generationBefore,
    generationAfter: mutation.generationAfter,
    preimages: mutation.preimages,
    plannedDigests: mutation.plannedDigests,
    committed: true,
  })));
}
function assertExpected(path: string, expected: Maybe<string>): string | null {
  const actual = existsSync(absolute(path)) ? traceDigest(read(path)) : null;
  const supplied = optional(expected);
  if (supplied !== undefined && supplied !== actual) fail("PreimageChanged", `expected digest for ${path} is stale (current ${actual ?? "absent"})`);
  return actual;
}
function audit() { return { atCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(), transactionId: `netxn_${randomUUID().replaceAll("-", "")}` }; }
function planOne(action: CaseRelationAction, expected: Maybe<string>, operation: string, dryRun: boolean): Effect.Effect<unknown, CaseCliError | import("../trace/relation-mutation.js").TraceCoordinationError, never>;
function planOne<E, R>(action: CaseRelationAction, expected: Maybe<string>, operation: string, dryRun: boolean, validateUnderLease: Effect.Effect<void, E, R>): Effect.Effect<unknown, E | CaseCliError | import("../trace/relation-mutation.js").TraceCoordinationError, R>;
function planOne<E, R>(action: CaseRelationAction, expected: Maybe<string>, operation: string, dryRun: boolean, validateUnderLease?: Effect.Effect<void, E, R>) {
  const plan = Effect.sync(() => {
    const path = sidecarPath(action.selector.path); const before = decodeSidecar(path);
    if (optional(expected) !== undefined) fail("PreimageChanged", "sidecar digests are not accepted after inline relation migration; use the transaction source preimages");
    const planned = planCaseRelation(before, action, audit());
    if (Result.isFailure(planned)) fail(planned.failure._tag, JSON.stringify(planned.failure));
    const next = Result.match(planned, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
    return { changes: annotationProjectionChanges([{ before, next }]), value: `${action.selector.path}#${action.selector.caseId}` };
  });
  return publish(operation, dryRun, validateUnderLease === undefined ? plan : validateUnderLease.pipe(Effect.andThen(plan)));
}
function validateOpenProblem(memory: string) { return compileTrace(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => { const item = snapshot.memory.find((entry) => entry.path === memory); if (item?.kind !== "problem" || item.state !== "open") fail("RegressionTargetInvalid", `${memory} must be an open structured Problem Memory`); })); }
function validateOpenProblemUnderLease(memory: string) { return compileTraceUnderLease(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => { const item = snapshot.memory.find((entry) => entry.path === memory); if (item?.kind !== "problem" || item.state !== "open") fail("RegressionTargetInvalid", `${memory} must be an open structured Problem Memory`); })); }
function validateRetirableProblem(memory: string) { return compileTrace(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => { const item = snapshot.memory.find((entry) => entry.path === memory); if (item?.kind === "problem" && item.state === "resolved") fail("RegressionRequiresReopen", `${memory} is resolved; reopen it before retiring the regression`); })); }
function validateRetirableProblemUnderLease(memory: string) { return compileTraceUnderLease(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => { const item = snapshot.memory.find((entry) => entry.path === memory); if (item?.kind === "problem" && item.state === "resolved") fail("RegressionRequiresReopen", `${memory} is resolved; reopen it before retiring the regression`); })); }
interface FormalReceipt {
  readonly format: "niceeval.e2e-case-receipt/v2";
  readonly mode: "formal";
  readonly observation: "red" | "green" | "reliability";
  readonly selector: string;
  readonly caseId: string;
  readonly inventoryDigest: string;
  readonly candidate: { readonly sha256: string };
  readonly source: RepositorySourceIdentityV3;
  readonly result: { readonly disposition: "regression" | "pass" };
  readonly cleanup: { readonly ok: boolean };
  readonly invocationId: string;
  readonly receiptSha256: string;
}

function projectRootForTest(testFile: string): string {
  let directory = posix.dirname(testFile);
  while (directory === "e2e" || directory.startsWith("e2e/")) {
    if (existsSync(absolute(`${directory}/project.json`))) return absolute(directory);
    const parent = posix.dirname(directory); if (parent === directory) break; directory = parent;
  }
  return fail("EvidenceMismatch", `cannot find the E2E project root for ${testFile}`);
}

function validateRegressionEvidence(action: AddRegressionInput, parsed: CaseSelector) {
  let inventory: CaseInventoryReceipt;
  try { inventory = readManagedInventoryReceipt(REPOSITORY_ROOT, action.inventory, action.selector); }
  catch (cause) { return fail("EvidenceMismatch", detail(cause)); }
  if (!inventory.cases.some((item) => `${item.path}#${item.caseId}` === action.selector)) fail("CaseNotCollected", action.selector);
  let managedRed: ReturnType<typeof readManagedRedEvidence>;
  let managedTakeover: ReturnType<typeof readManagedTakeoverEvidence>;
  try {
    managedRed = readManagedRedEvidence(REPOSITORY_ROOT, action.red);
    managedTakeover = readManagedTakeoverEvidence(REPOSITORY_ROOT, action.takeover);
  } catch (cause) { return fail("EvidenceMismatch", detail(cause)); }
  const red = managedRed.receipt as unknown as FormalReceipt;
  const certificate = managedTakeover.certificate as unknown as Record<string, unknown>;
  if (certificate.format !== "niceeval.e2e-takeover-certificate/v2") fail("EvidenceLegacy", "legacy v1 takeover evidence is read-only history and cannot register or refresh a current fixed regression");
  const greenKey = managedTakeover.certificate.greenReceipt;
  const greenValue = managedTakeover.receipts.get(greenKey);
  if (greenValue === undefined) fail("EvidenceMismatch", "managed takeover evidence is missing its green receipt");
  const green = greenValue as unknown as FormalReceipt;
  if (red.format !== "niceeval.e2e-case-receipt/v2" || green.format !== "niceeval.e2e-case-receipt/v2") fail("EvidenceLegacy", "legacy v1 evidence is read-only history and cannot register or refresh a current fixed regression");
  if (red.selector !== action.selector || red.inventoryDigest !== inventory.digest) fail("EvidenceMismatch", "managed red evidence does not bind this selector and inventory");
  if (green.selector !== action.selector || green.inventoryDigest !== inventory.digest) fail("EvidenceMismatch", "managed takeover evidence does not bind this selector and inventory");
  if (managedTakeover.certificate.caseId !== green.caseId || managedTakeover.certificate.candidateSha256 !== green.candidate.sha256) fail("EvidenceMismatch", "takeover certificate does not bind the green receipt, selector, and candidate");
  const observations = managedTakeover.certificate.observations;
  const reliabilityPaths = [...(Array.isArray(observations?.isolatedCopies) ? observations.isolatedCopies : []), ...(Array.isArray(observations?.sameCopy) ? observations.sameCopy : []), observations?.defaultParallel].filter((item): item is string => typeof item === "string");
  if (reliabilityPaths.length !== 6 || observations.singleCase !== greenKey || !Array.isArray(observations?.cleanup) || observations.cleanup.length === 0) fail("EvidenceMismatch", "takeover certificate is missing the complete observation matrix");
  const reliability = reliabilityPaths.map((path) => {
    const receipt = managedTakeover.receipts.get(path);
    return receipt === undefined ? fail("EvidenceMismatch", `managed takeover evidence is missing ${path}`) : receipt as unknown as FormalReceipt;
  });
  if (reliability.some((item) => item.observation !== "reliability" || item.result.disposition !== "pass" || item.candidate.sha256 !== green.candidate.sha256)) fail("EvidenceMismatch", "takeover observations do not all pass on the green candidate");
  if (new Set([red.invocationId, green.invocationId, ...reliability.map((item) => item.invocationId)]).size !== reliability.length + 2) fail("EvidenceMismatch", "formal evidence reuses an invocation ID");
  if (reliability.some((receipt) => receipt.format !== "niceeval.e2e-case-receipt/v2")) fail("EvidenceLegacy", "legacy v1 reliability evidence cannot register or refresh a current fixed regression");
  const currentSource = resolveRepositorySourceIdentity(REPOSITORY_ROOT, projectRootForTest(parsed.path), action.selector);
  if (![red, green, ...reliability].every((receipt) => sameRepositorySourceIdentity(receipt.source, currentSource))) fail("EvidenceMismatch", "formal evidence does not bind the current code projection, declaration, owner, and contract sources");
  if (![red, ...reliability].every((receipt) => receipt.source.projection.digest === green.source.projection.digest)) fail("EvidenceMismatch", "red, green, and reliability evidence do not bind one common source projection");
  return { inventory, red, green, certificate, reliability, certificateObservations: observations };
}

function currentV2EvidenceStillValid(value: unknown, currentSource: RepositorySourceIdentityV3): boolean {
  try {
    if (value === null || typeof value !== "object") return false;
    const evidence = value as Record<string, unknown>;
    const load = (name: "red" | "green" | "certificate"): Record<string, unknown> => {
      const reference = evidence[name];
      if (reference === null || typeof reference !== "object") throw new Error(`missing ${name} evidence reference`);
      const path = (reference as Record<string, unknown>).path;
      const digest = (reference as Record<string, unknown>).digest;
      if (typeof path !== "string" || typeof digest !== "string" || !existsSync(absolute(path))) throw new Error(`unavailable ${name} evidence`);
      const bytes = read(path);
      if (traceDigest(bytes) !== digest) throw new Error(`${name} evidence digest changed`);
      const document = JSON.parse(bytes) as unknown;
      if (document === null || typeof document !== "object") throw new Error(`${name} evidence is not an object`);
      return document as Record<string, unknown>;
    };
    const red = load("red");
    const green = load("green");
    const certificate = load("certificate");
    if (red.format !== "niceeval.e2e-case-receipt/v2" || green.format !== "niceeval.e2e-case-receipt/v2" || certificate.format !== "niceeval.e2e-takeover-certificate/v2") return false;
    const redSource = red.source as RepositorySourceIdentityV3;
    const greenSource = green.source as RepositorySourceIdentityV3;
    return sameRepositorySourceIdentity(redSource, currentSource)
      && sameRepositorySourceIdentity(greenSource, currentSource)
      && certificate.sourceDigest === currentSource.projection.digest;
  } catch {
    return false;
  }
}

function addRegression(action: AddRegressionInput | RefreshRegressionInput, parsed: CaseSelector, refresh = false) {
  if (refresh && (!("reason" in action) || action.reason.trim().length === 0)) fail("InvalidReason", "regression refresh requires a non-empty reason");
  return validateOpenProblem(action.memory).pipe(Effect.andThen(Effect.suspend(() => {
    const relationPath = sidecarPath(parsed.path);
    const before = decodeSidecar(relationPath);
    const indexPath = evidencePath(parsed.path);
    const indexDigest = assertExpected(indexPath, undefined);
    const index = existsSync(absolute(indexPath))
      ? JSON.parse(read(indexPath)) as { format: string; current: Record<string, Record<string, unknown>> }
      : { format: "niceeval.e2e-case-evidence-index/v1", current: {} };
    if (index.format !== "niceeval.e2e-case-evidence-index/v1") fail("EvidenceMismatch", `${indexPath} has an unknown format`);
    const currentCase = index.current[parsed.caseId] ?? {};
    const selected = selectCurrentCase(before, parsed);
    const relation = Result.match(selected, {
      onFailure: (error) => fail(error._tag, JSON.stringify(error)),
      onSuccess: (value) => value,
    });
    const relationAlreadyCurrent = relation.regressions.includes(action.memory);
    if (!refresh && relationAlreadyCurrent && currentCase[action.memory] !== undefined) {
      fail("RelationAlreadyCurrent", JSON.stringify({
        selector: action.selector,
        relation: "regression",
        value: action.memory,
        _tag: "RelationAlreadyCurrent",
      }));
    }
    if (refresh && (!relationAlreadyCurrent || currentCase[action.memory] === undefined)) fail("RelationNotCurrent", `refresh requires an existing current regression and evidence for ${action.memory}`);
    if (refresh) {
      const currentSource = resolveRepositorySourceIdentity(REPOSITORY_ROOT, projectRootForTest(parsed.path), action.selector);
      if (currentV2EvidenceStillValid(currentCase[action.memory], currentSource)) fail("EvidenceAlreadyCurrent", `current v2 evidence for ${action.memory} still binds the current source identity`);
    }
    const verified = validateRegressionEvidence(action, parsed);
    const next = relationAlreadyCurrent
      ? before
      : Result.match(
          planCaseRelation(before, { _tag: "AddRegression", selector: parsed, memory: action.memory }, audit()),
          { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value },
        );
    const evidenceRoot = `${parsed.path}.case-evidence/${parsed.caseId}/${action.memory.replaceAll("/", "_")}/${action.red}-${action.takeover}`;
    const inventoryEvidencePath = `${evidenceRoot}/inventory.json`;
    const copied = [
      { value: verified.red, path: `${evidenceRoot}/red.json` },
      { value: verified.green, path: `${evidenceRoot}/green.json` },
      ...verified.reliability.map((value, index) => ({ value, path: `${evidenceRoot}/reliability-${index + 1}.json` })),
    ];
    const greenPath = copied[1]!.path;
    const normalizedCertificateUnsigned: Record<string, unknown> = {
      ...(verified.certificate as Record<string, unknown>),
      greenReceipt: greenPath,
      observations: {
        isolatedCopies: copied.slice(2, 5).map((item) => item.path),
        sameCopy: copied.slice(5, 7).map((item) => item.path),
        defaultParallel: copied[7]!.path,
        singleCase: greenPath,
        cleanup: verified.certificateObservations.cleanup,
      },
    };
    delete normalizedCertificateUnsigned.certificateSha256;
    const normalizedCertificate = { ...normalizedCertificateUnsigned, certificateSha256: signatureSha(canonicalJson(normalizedCertificateUnsigned)) };
    const certificatePath = `${evidenceRoot}/certificate.json`;
    const evidence = {
      red: { path: copied[0]!.path, digest: traceDigest(`${JSON.stringify(verified.red, null, 2)}\n`) },
      green: { path: greenPath, digest: traceDigest(`${JSON.stringify(verified.green, null, 2)}\n`) },
      certificate: { path: certificatePath, digest: traceDigest(`${JSON.stringify(normalizedCertificate, null, 2)}\n`) },
      inventory: { path: inventoryEvidencePath, digest: verified.inventory.digest },
    };
    const nextIndex = {
      ...index,
      current: { ...index.current, [parsed.caseId]: { ...currentCase, [action.memory]: evidence } },
      ...(refresh ? { history: [...((index as { history?: readonly unknown[] }).history ?? []), { caseId: parsed.caseId, memory: action.memory, evidence: currentCase[action.memory], reason: (action as RefreshRegressionInput).reason, refreshedAtCommit: audit().atCommit }] } : {}),
    };
    return publish(refresh ? "test-regression-refresh" : "test-regression-add", action.dryRun, validateOpenProblemUnderLease(action.memory).pipe(
      Effect.andThen(Effect.sync(() => {
        if (refresh) {
          const latestIndex = JSON.parse(read(indexPath)) as { readonly current?: Readonly<Record<string, Readonly<Record<string, unknown>>>> };
          const latestCurrent = latestIndex.current?.[parsed.caseId]?.[action.memory];
          const latestSource = resolveRepositorySourceIdentity(REPOSITORY_ROOT, projectRootForTest(parsed.path), action.selector);
          if (currentV2EvidenceStillValid(latestCurrent, latestSource)) fail("EvidenceAlreadyCurrent", `current v2 evidence for ${action.memory} still binds the current source identity`);
        }
        validateRegressionEvidence(action, parsed);
      })),
      Effect.as({ changes: [
      // Evidence-only repair still depends on the current relation/owner. Keep
      // its declaration source as a no-op transaction member so journal CAS binds it.
      ...annotationProjectionChanges([{ before, next }]),
      { path: indexPath, bytes: `${JSON.stringify(nextIndex, null, 2)}\n`, expectedDigest: indexDigest },
      { path: inventoryEvidencePath, bytes: `${JSON.stringify(verified.inventory, null, 2)}\n`, expectedDigest: null },
      ...copied.map((item) => ({ path: item.path, bytes: `${JSON.stringify(item.value, null, 2)}\n`, expectedDigest: null })),
      { path: certificatePath, bytes: `${JSON.stringify(normalizedCertificate, null, 2)}\n`, expectedDigest: null },
    ], value: action.selector }),
    ));
  })));
}

function retireRegression(action: RetireRegressionInput, parsed: CaseSelector) {
  return validateRetirableProblem(action.memory).pipe(Effect.andThen(Effect.suspend(() => {
    const relationPath = sidecarPath(parsed.path);
    const before = decodeSidecar(relationPath);
    const planned = planCaseRelation(before, { _tag: "RetireRegression", selector: parsed, memory: action.memory, reason: action.reason }, audit());
    const next = Result.match(planned, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
    const indexPath = evidencePath(parsed.path);
    const indexDigest = assertExpected(indexPath, undefined);
    const index = JSON.parse(read(indexPath)) as { format: string; current: Record<string, Record<string, unknown>>; history?: readonly unknown[] };
    const evidence = index.current[parsed.caseId]?.[action.memory];
    if (evidence === undefined) fail("EvidenceMismatch", `current evidence for ${action.memory} is missing`);
    const currentCase = { ...(index.current[parsed.caseId] ?? {}) };
    delete currentCase[action.memory];
    const nextIndex = {
      ...index,
      current: { ...index.current, [parsed.caseId]: currentCase },
      history: [...(index.history ?? []), { caseId: parsed.caseId, memory: action.memory, evidence, reason: action.reason, retiredAtCommit: audit().atCommit }],
    };
    return publish("test-regression-retire", action.dryRun, validateRetirableProblemUnderLease(action.memory).pipe(Effect.as({ changes: [
      ...annotationProjectionChanges([{ before, next }]),
      { path: indexPath, bytes: `${JSON.stringify(nextIndex, null, 2)}\n`, expectedDigest: indexDigest },
    ], value: action.selector })));
  })));
}

function verifyIssue(url: string, selectorText: string, injected: Maybe<string>): CaseIssue {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]*)$/u.exec(url);
  if (match === null) return fail("IssueVerificationFailed", "Issue URL must be canonical https://github.com/owner/repo/issues/N");
  const repository = `github.com/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`; const number = Number(match[3]);
  const receiptPath = optional(injected);
  let document: Record<string, unknown>;
  if (receiptPath !== undefined) {
    if (process.env.NICEEVAL_TEST_CASE_ALLOW_VERIFIED_RECEIPT !== "1") return fail("IssueVerificationFailed", "injected verification receipts are disabled outside an explicit isolated fixture");
    document = JSON.parse(readFileSync(resolve(receiptPath), "utf8")) as Record<string, unknown>;
  }
  else {
    let remote: string; try { remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(); } catch { return fail("IssueVerificationFailed", "cannot determine the canonical repository; refusing offline verification"); }
    const remoteMatch = /(?:github\.com[/:])([^/]+)\/([^/.]+)(?:\.git)?$/u.exec(remote);
    if (remoteMatch === null || `github.com/${remoteMatch[1]!.toLowerCase()}/${remoteMatch[2]!.toLowerCase()}` !== repository) return fail("IssueVerificationFailed", "Issue is not in this checkout's canonical repository");
    try { document = JSON.parse(execFileSync("gh", ["api", `repos/${match[1]}/${match[2]}/issues/${number}`], { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as Record<string, unknown>; }
    catch { return fail("IssueVerificationFailed", "GitHub read-only verification is unavailable; refusing local publication"); }
  }
  if (document.format === "niceeval.test-case-issue-verification/v1" && (document.selector !== selectorText || document.url !== url)) return fail("IssueVerificationFailed", "injected verification receipt does not bind this selector and URL");
  if (document.pull_request !== undefined || document.isPullRequest === true) return fail("IssueVerificationFailed", "target is a Pull Request, not an Issue");
  const body = typeof document.body === "string" ? document.body : ""; if (!body.includes(selectorText)) return fail("IssueVerificationFailed", "Issue body does not contain direct provenance for the exact selector");
  const nodeId = typeof document.node_id === "string" ? document.node_id : typeof document.nodeId === "string" ? document.nodeId : "";
  const title = typeof document.title === "string" ? document.title : ""; if (nodeId === "" || title === "") return fail("IssueVerificationFailed", "Issue identity receipt is incomplete");
  return { repository, number, url, nodeId, titleDigest: sha(title), checkedAt: new Date().toISOString(), provenance: "direct" };
}

export const inventoryCases = Effect.fn("inventoryCases")(function*(input: InventoryInput) {
  const collected = yield* collectInventory(input);
  const inventoryId = yield* Effect.try({ try: () => saveInventory(collected), catch: (cause) => cause });
  const reconciliation = reconcileInventory(collected);
  return {
    inventory: inventoryId,
    repo: input.repo,
    checkout: collected.checkout,
    caseCount: collected.cases.length,
    unassignedCases: collected.unassignedCases,
    findings: reconciliation.findings,
  };
});

export const listCases = Effect.fn("listCases")(function*(input: ListCasesInput) {
  return yield* Effect.try({
    try: () => {
      const all = records(input.history, inventoryForId(input.inventory));
      const pattern = optional(input.pattern);
      return {
        format: "niceeval.e2e-case-list/v1",
        cases: pattern === undefined ? all : all.filter((item) => JSON.stringify(item).includes(pattern)),
      };
    },
    catch: (cause) => cause,
  });
});

export const showCase = Effect.fn("showCase")(function*(input: ShowCaseInput) {
  return yield* Effect.try({
    try: () => {
      const parsed = selector(input.selector);
      const canonical = `${parsed.path}#${parsed.caseId}`;
      return records(input.history, inventoryForId(input.inventory)).find((entry) => entry.selector === canonical)
        ?? fail("CaseNotCurrent", input.selector);
    },
    catch: (cause) => cause,
  });
});

export const auditCases = Effect.fn("auditCases")(function*(input: AuditCasesInput) {
  const inventory = yield* Effect.scoped(collectWorkspaceCaseInventory(input.checkout)).pipe(
    Effect.mapError((cause) => new CaseCliError("WorkspaceInventoryIncomplete", detail(cause))),
  );
  const snapshot = yield* compileTrace(REPOSITORY_ROOT);
  const current = records(false);
  const related = new Map(current.map((item) => [item.selector, item]));
  const collected = new Map(inventory.cases.map((item) => [`${item.path}#${item.caseId}`, item]));
  const coveredUseCases = new Set(snapshot.tests.flatMap((test) => test.contract === undefined ? [] : [test.contract]));
  return {
    format: "niceeval.e2e-case-audit/v1",
    inventory,
    uncoveredUseCases: snapshot.nodes
      .filter((node) => node.kind === "use-case" && !coveredUseCases.has(node.path))
      .map((node) => ({ path: node.path, title: node.title })),
    unassignedCases: inventory.unassignedCases,
    missingRelations: inventory.cases
      .filter((item) => !related.has(`${item.path}#${item.caseId}`))
      .map((item) => ({ selector: `${item.path}#${item.caseId}`, repo: item.repo, titlePath: item.titlePath })),
    orphanedRelations: current
      .filter((item) => !collected.has(item.selector))
      .map((item) => ({ selector: item.selector, contract: "relation" in item ? item.relation.contract : null })),
  };
});

export const retireCase = Effect.fn("retireCase")(function*(input: RetireCaseInput) {
  const parsed = selector(input.selector);
  return yield* planOne({ _tag: "RetireCase", selector: parsed, reason: input.reason }, undefined, "test-case-retire", input.dryRun);
});
export const addCaseRegression = Effect.fn("addCaseRegression")(function*(input: AddRegressionInput) { return yield* addRegression(input, selector(input.selector)); });
export const refreshCaseRegression = Effect.fn("refreshCaseRegression")(function*(input: RefreshRegressionInput) { return yield* addRegression(input, selector(input.selector), true); });
export const retireCaseRegression = Effect.fn("retireCaseRegression")(function*(input: RetireRegressionInput) { return yield* retireRegression(input, selector(input.selector)); });
export const addCaseIssue = Effect.fn("addCaseIssue")(function*(input: AddIssueInput) {
  const parsed = selector(input.selector);
  const verified = verifyIssue(input.url, input.selector, input.verificationReceipt);
  return yield* publish("test-issue-add", input.dryRun, Effect.sync(() => {
    // This second boundary read is the publication CAS.  It deliberately
    // repeats direct-provenance validation rather than trusting the first
    // preflight result or a locally mutable fixture receipt.
    const current = verifyIssue(input.url, input.selector, input.verificationReceipt);
    if (current.nodeId !== verified.nodeId || current.titleDigest !== verified.titleDigest || current.repository !== verified.repository || current.number !== verified.number || current.provenance !== verified.provenance) {
      fail("IssueVerificationFailed", "Issue identity or direct provenance changed before publication");
    }
    const path = sidecarPath(parsed.path);
    const before = decodeSidecar(path);
    const planned = planCaseRelation(before, { _tag: "AddIssue", selector: parsed, issue: current }, audit());
    const next = Result.match(planned, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
    return { changes: annotationProjectionChanges([{ before, next }]), value: input.selector };
  }));
});
export const retireCaseIssue = Effect.fn("retireCaseIssue")(function*(input: RetireIssueInput) {
  const parsed = selector(input.selector);
  return yield* planOne({ _tag: "RetireIssue", selector: parsed, url: input.url, reason: input.reason }, undefined, "test-issue-retire", input.dryRun);
});
export function renderCaseCommandError(error: unknown): string { return `${error instanceof CaseCliError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error)}\n`; }
export function renderCaseReceipt(value: unknown): string { if (typeof value === "object" && value !== null && "cases" in value && Array.isArray(value.cases)) return `${value.cases.map((item) => typeof item === "object" && item !== null && "selector" in item ? String(item.selector) : JSON.stringify(item)).join("\n")}\n`; return `${JSON.stringify(value, null, 2)}\n`; }
