import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { Effect, Result, Schema } from "effect";
import { decode, RepositoryEvidenceSchema, type MemoryMeta, type RepositoryEvidence } from "concord-sdlc/model";
import { parseRepoRef, validateRepoRefTarget, type RepoRef, type ValidatedRepoRefTarget } from "../docs/trace/ref.js";
import { ADOPTABLE_DOCS_NODE_KINDS, type TraceSnapshot } from "../docs/trace/model.js";
import { traceDigest } from "../docs/trace/relation-mutation.js";
import { decodeMemoryDocument, encodeMemoryDocument } from "./codec.js";
import { MemoryContentInvalid, MemoryFileMissing, MemoryIoError, MemoryReferenceConflict, type MemoryError } from "./errors.js";
import type { MemoryDocument, ProblemResolutionIntent, PromotionKind } from "./schema.js";
import { activateMemory, promoteMemory, reopenProblem, resolveProblem, retirePromotion, supersedeMemory } from "./state.js";
import { decodeRepositorySourceIdentityV3, RepositorySourceIdentityV3Schema, resolveRepositorySourceIdentity, sameRepositorySourceIdentity } from "../source-identity.js";

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" :
  value !== null && typeof value === "object" ? "{" + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}" : JSON.stringify(value);
const canonicalDigest = (value: unknown): string => "sha256:" + sha(canonical(value));
const canonicalSignatureDigest = (value: unknown): string => sha(canonical(value));

export interface MemoryCheckReceipt { readonly ok: boolean; readonly checked: number; readonly findings: readonly string[] }
export interface MemoryAuthorSnapshot { readonly document: MemoryDocument; readonly ownerPreimageDigest: string; readonly authorRegionDigest: string }
export interface FixedEvidenceValidation { readonly selectors: readonly string[]; readonly preimagePaths: readonly string[]; readonly evidence: RepositoryEvidence }

const FileSchema = Schema.Struct({ path: Schema.String, digest: Schema.String });
const EvidenceEntrySchema = Schema.Struct({ red: FileSchema, green: FileSchema, certificate: FileSchema, inventory: FileSchema });
const EvidenceHistorySchema = Schema.Union([
  Schema.Struct({ caseId: Schema.String, memory: Schema.String, evidence: EvidenceEntrySchema, reason: Schema.String, refreshedAtCommit: Schema.String }),
  Schema.Struct({ caseId: Schema.String, memory: Schema.String, evidence: EvidenceEntrySchema, reason: Schema.String, retiredAtCommit: Schema.String }),
]);
const IndexSchema = Schema.Struct({ format: Schema.Literal("niceeval.e2e-case-evidence-index/v1"), current: Schema.Record(Schema.String, Schema.Record(Schema.String, EvidenceEntrySchema)), history: Schema.optional(Schema.Array(EvidenceHistorySchema)) });
const ReceiptSchema = Schema.Struct({ format: Schema.Literal("niceeval.e2e-case-receipt/v2"), mode: Schema.Literal("formal"), observation: Schema.Literals(["red", "green", "reliability"]), selector: Schema.String, caseId: Schema.String, inventoryDigest: Schema.String, candidate: Schema.Struct({ gitSha: Schema.String, sha256: Schema.String, sri: Schema.String }), source: RepositorySourceIdentityV3Schema, runner: Schema.Struct({ executor: Schema.Literals(["vitest", "playwright"]), version: Schema.String, argv: Schema.Array(Schema.String) }), result: Schema.Struct({ disposition: Schema.Literals(["regression", "pass"]), stage: Schema.String, exitCode: Schema.NullOr(Schema.Number), signal: Schema.NullOr(Schema.String) }), cleanup: Schema.Struct({ ok: Schema.Boolean, resources: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }), invocationId: Schema.String, receiptSha256: Schema.String });
const CollectedCaseSchema = Schema.Struct({ executor: Schema.Literals(["vitest", "playwright"]), repo: Schema.String, path: Schema.String, project: Schema.optional(Schema.String), titlePath: Schema.Array(Schema.String), caseId: Schema.String });
const RawCollectedCaseSchema = Schema.Struct({ file: Schema.String, project: Schema.optional(Schema.String), titlePath: Schema.Array(Schema.String) });
const InventorySchema = Schema.Struct({ executor: Schema.Struct({ name: Schema.Literals(["vitest", "playwright"]), version: Schema.String }), repo: Schema.String, argv: Schema.Array(Schema.String), checkout: Schema.String, files: Schema.Array(Schema.String), cases: Schema.Array(CollectedCaseSchema), unassignedCases: Schema.Array(RawCollectedCaseSchema), bodyExecutions: Schema.Literal(0), forbiddenSetupExecutions: Schema.Literal(0), findings: Schema.Array(Schema.Unknown), digest: Schema.String, exit: Schema.NullOr(Schema.Number), signal: Schema.NullOr(Schema.String) });
const CertificateSchema = Schema.Struct({ format: Schema.Literal("niceeval.e2e-takeover-certificate/v2"), selector: Schema.String, caseId: Schema.String, candidateSha256: Schema.String, sourceDigest: Schema.String, greenReceipt: Schema.String, observations: Schema.Struct({ isolatedCopies: Schema.Tuple([Schema.String, Schema.String, Schema.String]), sameCopy: Schema.Tuple([Schema.String, Schema.String]), defaultParallel: Schema.String, singleCase: Schema.String, cleanup: Schema.Array(Schema.String) }), certificateSha256: Schema.String });

function authorRegion(body: string): string { return body; }
function decodeJson(path: string, source: string): unknown { try { return JSON.parse(source); } catch (cause) { throw new MemoryReferenceConflict({ operation: "resolve", path, message: "invalid evidence JSON: " + message(cause) }); } }
function objectInput(path: string, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "evidence JSON must be an object" });
  return Object.fromEntries(Object.entries(input));
}
function checked<A>(path: string, schema: Schema.Codec<A>, input: unknown): A {
  const value = Schema.decodeUnknownResult(schema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(value)) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "invalid or incomplete fixed evidence" });
  return value.success;
}

export class MemoryRepository {
  readonly #root: string;
  constructor(root = process.cwd()) { this.#root = resolve(root); }
  get root(): string { return this.#root; }
  ownerPath(id: string): string { this.#guardId(id); return "memory/" + id + ".md"; }
  absoluteOwnerPath(id: string): string { return join(this.#root, this.ownerPath(id)); }
  #guardId(id: string): void { if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) throw new MemoryContentInvalid({ operation: "resolve id", message: "unsafe Memory id " + JSON.stringify(id) }); }
  list(): readonly MemoryDocument[] {
    const dir = join(this.#root, "memory");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md" && entry.name !== "README.md").map((entry) => this.read(entry.name.slice(0, -3))).sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));
  }
  read(id: string): MemoryDocument {
    const path = this.absoluteOwnerPath(id);
    this.#assertOwnerPath(id, path);
    if (!existsSync(path)) throw new MemoryFileMissing({ operation: "read", path: this.ownerPath(id), message: "not found" });
    try { return decodeMemoryDocument(this.ownerPath(id), id, readFileSync(path, "utf8")); } catch (cause) { if (cause instanceof MemoryContentInvalid || cause instanceof MemoryFileMissing) throw cause; throw new MemoryIoError({ operation: "read", path: this.ownerPath(id), message: message(cause) }); }
  }
  readAuthorSnapshot(id: string): MemoryAuthorSnapshot {
    const path = this.absoluteOwnerPath(id); this.#assertOwnerPath(id, path);
    const source = readFileSync(path, "utf8");
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    return { document, ownerPreimageDigest: traceDigest(source), authorRegionDigest: traceDigest(authorRegion(document.body)) };
  }
  #assertOwnerPath(id: string, path: string): void {
    if (lstatSync(this.#root).isSymbolicLink()) throw new MemoryContentInvalid({ operation: "read", path: this.ownerPath(id), message: "repository root is a symlink" });
    const directory = join(this.#root, "memory");
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new MemoryContentInvalid({ operation: "read", path: this.ownerPath(id), message: "memory directory is a symlink" });
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new MemoryContentInvalid({ operation: "read", path: this.ownerPath(id), message: "memory owner is a symlink" });
  }
  planCreate(metadata: MemoryMeta, body: string) {
    this.#guardId(metadata.id);
    if (metadata.promotions.length !== 0 || metadata.history.length !== 0 || metadata.resolution !== undefined || metadata.supersededBy !== undefined || metadata.supersession !== undefined) throw new MemoryReferenceConflict({ operation: "add", message: "new Memory has no history, resolution, promotion, or supersession" });
    const valid = metadata.memoryKind === "problem" ? metadata.state === "open" : metadata.memoryKind === "note" ? metadata.state === "captured" : metadata.state === "current";
    if (!valid || existsSync(this.absoluteOwnerPath(metadata.id))) throw new MemoryReferenceConflict({ operation: "add", path: this.ownerPath(metadata.id), message: "invalid initial Memory state or existing owner" });
    return { bytes: encodeMemoryDocument(metadata, body), metadata };
  }
  planTransition(id: string, source: string | undefined, transition: (value: MemoryMeta) => Result.Result<MemoryMeta, MemoryReferenceConflict>) {
    if (source === undefined) throw new MemoryFileMissing({ operation: "mutate", path: this.ownerPath(id), message: "not found" });
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    const result = transition(document.metadata);
    if (Result.isFailure(result)) throw result.failure;
    return { bytes: encodeMemoryDocument(result.success, document.body), metadata: result.success };
  }
  planAuthorSet(id: string, source: string | undefined, body: string, expectedOwnerDigest: string, expectedAuthorDigest: string) {
    if (source === undefined || traceDigest(source) !== expectedOwnerDigest) throw new MemoryReferenceConflict({ operation: "author set", path: this.ownerPath(id), message: "owner preimage changed or is missing" });
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    if (traceDigest(authorRegion(document.body)) !== expectedAuthorDigest) throw new MemoryReferenceConflict({ operation: "author set", path: this.ownerPath(id), message: "author region changed" });
    return { bytes: encodeMemoryDocument(document.metadata, body), metadata: document.metadata };
  }
  planResolve(id: string, source: string | undefined, intent: ProblemResolutionIntent, evidence: RepositoryEvidence | undefined, commit?: string) {
    if (source === undefined) throw new MemoryFileMissing({ operation: "resolve", path: this.ownerPath(id), message: "not found" });
    const current = decodeMemoryDocument(this.ownerPath(id), id, source).metadata;
    if (intent.kind === "fixed") {
      if (evidence === undefined) throw new MemoryReferenceConflict({ operation: "resolve", path: this.ownerPath(id), message: "fixed resolution requires the exclusive formal repository gate" });
      const used = [...current.history, ...(current.resolution === undefined ? [] : [{ resolution: current.resolution }])].flatMap((entry) => entry.resolution?.kind === "fixed" && entry.resolution.evidenceLevel === "repository" ? entry.resolution.repositoryEvidence.cases.flatMap((item) => item.invocationIds) : []);
      const next = evidence.cases.flatMap((item) => item.invocationIds);
      if (next.some((invocationId) => used.includes(invocationId))) throw new MemoryReferenceConflict({ operation: "resolve", path: this.ownerPath(id), message: "repository evidence invocation identities were already used by this Memory" });
    }
    const at = intent.at ?? new Date().toISOString();
    const actual = intent.kind === "fixed" ? { kind: "fixed" as const, reason: intent.reason, at, epoch: current.epoch, evidenceLevel: "repository" as const, repositoryEvidence: evidence! } : { kind: intent.kind, reason: intent.reason, at, epoch: current.epoch, evidenceLevel: "author" as const };
    return this.planTransition(id, source, (value) => resolveProblem(value, actual, commit));
  }
  planActivate(id: string, source: string | undefined, reason: string, at: string, commit?: string) { return this.planTransition(id, source, (value) => activateMemory(value, reason, at, commit)); }
  planReopen(id: string, source: string | undefined, reason: string, at: string, commit?: string) { return this.planTransition(id, source, (value) => reopenProblem(value, reason, at, commit)); }
  planSupersede(id: string, source: string | undefined, replacement: MemoryMeta, reason: string, at: string, replacementRef: string, commit?: string) { return this.planTransition(id, source, (value) => supersedeMemory(value, replacement, replacementRef, reason, at, commit)); }
  planPromote(id: string, source: string | undefined, target: string, at: string, commit?: string) { return this.planTransition(id, source, (value) => promoteMemory(value, target, at, commit)); }
  planRetire(id: string, source: string | undefined, target: string, reason: string, at: string, commit?: string) { return this.planTransition(id, source, (value) => retirePromotion(value, target, reason, at, commit)); }
  targetSource(target: unknown) {
    const parsed = parseRepoRef(target); if (Result.isFailure(parsed)) throw new MemoryReferenceConflict({ operation: "target", message: parsed.failure.message });
    const absolutePath = resolve(this.#root, parsed.success.path);
    if (lstatSync(this.#root).isSymbolicLink()) throw new MemoryReferenceConflict({ operation: "target", path: parsed.success.path, message: "repository root is a symlink" });
    let ancestor = this.#root;
    for (const part of parsed.success.path.split("/").filter(Boolean)) {
      ancestor = join(ancestor, part);
      if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new MemoryReferenceConflict({ operation: "target", path: parsed.success.path, message: "target path contains a symlink component" });
    }
    if (!absolutePath.startsWith(this.#root + sep) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) throw new MemoryReferenceConflict({ operation: "target", path: parsed.success.path, message: "target missing or unsafe" });
    return { path: parsed.success.path, absolutePath, source: readFileSync(absolutePath, "utf8") };
  }
  validateTarget(snapshot: TraceSnapshot, target: unknown): ValidatedRepoRefTarget & { readonly kind: PromotionKind } {
    const source = this.targetSource(target); const result = validateRepoRefTarget(snapshot, target, ADOPTABLE_DOCS_NODE_KINDS, source.source);
    if (Result.isFailure(result)) throw new MemoryReferenceConflict({ operation: "target", path: source.path, message: result.failure.message });
    if (!["roadmap", "feature", "use-case", "engineering"].includes(result.success.kind)) throw new MemoryReferenceConflict({ operation: "target", path: source.path, message: "unsupported promotion target" });
    return result.success as ValidatedRepoRefTarget & { readonly kind: PromotionKind };
  }
  validateFixedEvidence(snapshot: TraceSnapshot, memoryPath: string, options: { readonly requireOpen?: boolean } = {}): FixedEvidenceValidation {
    const related = snapshot.tests.filter((test) => test.regressions.some((reference) => reference.split("#", 1)[0] === memoryPath));
    const memoryId = memoryPath.slice("memory/".length, -3); const memory = this.read(memoryId).metadata;
    if (memory.memoryKind !== "problem" || (options.requireOpen !== false && memory.state !== "open")) throw new MemoryReferenceConflict({ operation: "resolve", path: memoryPath, message: "fixed gate requires the current open Problem Memory" });
    if (related.length === 0) throw new MemoryReferenceConflict({ operation: "resolve", path: memoryPath, message: "fixed gate requires a current regression case" });
    const preimages = new Set<string>([memoryPath]); const cases: unknown[] = [];
    for (const test of related) {
      const indexPath = test.path + ".cases.evidence.json"; const index = checked(indexPath, IndexSchema, decodeJson(indexPath, this.targetSource(indexPath).source));
      preimages.add(indexPath); const entry = index.current[test.caseId]?.[memoryPath];
      if (entry === undefined) throw new MemoryReferenceConflict({ operation: "resolve", path: indexPath, message: "no current evidence for selector and Memory" });
      const inventoryRaw = this.targetSource(entry.inventory.path).source; preimages.add(entry.inventory.path);
      const inventoryInput = objectInput(entry.inventory.path, decodeJson(entry.inventory.path, inventoryRaw)); const inventory = checked(entry.inventory.path, InventorySchema, inventoryInput);
      const inventoryUnsigned = { ...inventoryInput }; delete inventoryUnsigned.digest;
      if (inventory.digest !== canonicalDigest(inventoryUnsigned) || inventory.digest !== entry.inventory.digest || inventory.findings.length !== 0 || inventory.bodyExecutions !== 0 || inventory.forbiddenSetupExecutions !== 0 || !inventory.cases.some((item) => item.path + "#" + item.caseId === test.selector)) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.inventory.path, message: "inventory is not a clean current selector inventory" });
      let projectDirectory = test.path.slice(0, test.path.lastIndexOf("/"));
      while (projectDirectory.startsWith("e2e/") && !existsSync(join(this.#root, projectDirectory, "project.json"))) projectDirectory = projectDirectory.slice(0, projectDirectory.lastIndexOf("/"));
      if (!projectDirectory.startsWith("e2e/") || !existsSync(join(this.#root, projectDirectory, "project.json"))) throw new MemoryReferenceConflict({ operation: "resolve", path: test.path, message: "cannot locate E2E project root" });
      const currentSource = resolveRepositorySourceIdentity(this.#root, join(this.#root, projectDirectory), test.selector);
      preimages.add(currentSource.declarationFile); preimages.add(currentSource.binding.contractRef.split("#", 1)[0]!);
      for (const file of currentSource.projection.files) preimages.add(projectDirectory + "/" + file.path);
      const readReceipt = (file: { path: string; digest?: string }) => {
        const raw = this.targetSource(file.path).source; preimages.add(file.path); if (file.digest !== undefined && traceDigest(raw) !== file.digest) throw new MemoryReferenceConflict({ operation: "resolve", path: file.path, message: "evidence digest mismatch" });
        const input = objectInput(file.path, decodeJson(file.path, raw)); const declared = input.receiptSha256; const body = { ...input }; delete body.receiptSha256;
        if (declared !== canonicalSignatureDigest(body)) throw new MemoryReferenceConflict({ operation: "resolve", path: file.path, message: "receipt signature mismatch" });
        const receipt = checked(file.path, ReceiptSchema, input); let source;
        try { source = decodeRepositorySourceIdentityV3(receipt.source); } catch (cause) { throw new MemoryReferenceConflict({ operation: "resolve", path: file.path, message: message(cause) }); }
        if (receipt.selector !== test.selector || receipt.caseId !== test.caseId || receipt.inventoryDigest !== inventory.digest || !receipt.cleanup.ok || !sameRepositorySourceIdentity(source, currentSource)) throw new MemoryReferenceConflict({ operation: "resolve", path: file.path, message: "receipt does not match current selector/source" });
        return { receipt, source };
      };
      const red = readReceipt(entry.red); const green = readReceipt(entry.green);
      if (red.receipt.observation !== "red" || red.receipt.result.disposition !== "regression" || green.receipt.observation !== "green" || green.receipt.result.disposition !== "pass" || red.source.projection.digest !== green.source.projection.digest) throw new MemoryReferenceConflict({ operation: "resolve", path: indexPath, message: "red/green gate failed" });
      const certRaw = this.targetSource(entry.certificate.path).source; preimages.add(entry.certificate.path); if (traceDigest(certRaw) !== entry.certificate.digest) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "evidence index digest does not match certificate bytes" }); const certInput = objectInput(entry.certificate.path, decodeJson(entry.certificate.path, certRaw)); const certUnsigned = { ...certInput }; delete certUnsigned.certificateSha256;
      if (certInput.certificateSha256 !== canonicalSignatureDigest(certUnsigned)) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "certificate signature mismatch" });
      const certificate = checked(entry.certificate.path, CertificateSchema, certInput);
      if (certificate.selector !== test.selector || certificate.caseId !== test.caseId || certificate.candidateSha256 !== green.receipt.candidate.sha256 || certificate.greenReceipt !== entry.green.path || certificate.sourceDigest !== green.source.projection.digest || certificate.observations.singleCase !== entry.green.path || certificate.observations.cleanup.length === 0) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "takeover certificate is incomplete" });
      const reliabilityPaths = [...certificate.observations.isolatedCopies, ...certificate.observations.sameCopy, certificate.observations.defaultParallel]; if (new Set(reliabilityPaths).size !== 6) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "reliability receipts are not six distinct paths" });
      const reliability = reliabilityPaths.map((path) => readReceipt({ path }).receipt);
      if (reliability.some((item) => item.observation !== "reliability" || item.result.disposition !== "pass" || item.candidate.sha256 !== green.receipt.candidate.sha256 || item.source.projection.digest !== green.source.projection.digest)) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "reliability gate failed" });
      const invocationIds = [red.receipt.invocationId, green.receipt.invocationId, ...reliability.map((item) => item.invocationId)];
      if (invocationIds.length !== 8 || new Set(invocationIds).size !== 8) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "formal gate requires eight distinct invocation identities" });
      cases.push({ selector: test.selector, caseId: test.caseId, binding: currentSource.binding, sourceDigest: green.source.projection.digest, candidateSha256: green.receipt.candidate.sha256, red: { path: entry.red.path, digest: traceDigest(this.targetSource(entry.red.path).source) }, green: { path: entry.green.path, digest: traceDigest(this.targetSource(entry.green.path).source) }, certificate: { path: entry.certificate.path, digest: traceDigest(certRaw) }, inventory: { path: entry.inventory.path, digest: traceDigest(inventoryRaw) }, reliability: reliabilityPaths.map((path) => ({ path, digest: traceDigest(this.targetSource(path).source) })), invocationIds });
    }
    const evidence = decode(RepositoryEvidenceSchema, { memory: memoryPath, epoch: memory.epoch, validatedAt: new Date().toISOString(), cases }, memoryPath);
    return { selectors: related.map((test) => test.selector).sort(), preimagePaths: [...preimages].sort(), evidence };
  }
  search(pattern: string): readonly MemoryDocument[] { const needle = pattern.toLocaleLowerCase(); return this.list().filter((item) => (item.metadata.id + "\n" + item.metadata.title + "\n" + item.body).toLocaleLowerCase().includes(needle)); }
  check(snapshot: TraceSnapshot): MemoryCheckReceipt {
    const findings: string[] = []; const documents = this.list(); const byRef = new Map(documents.map((item) => ["memory/" + item.metadata.id + ".md", item.metadata]));
    for (const item of documents) {
      const m = item.metadata;
      if (m.state === "captured" && (m.resolution !== undefined || m.promotions.length > 0)) findings.push(m.id + ": captured Memory cannot have resolution or promotion");
      if (m.memoryKind === "note" && (m.state !== "captured" || m.resolution !== undefined || m.promotions.length > 0)) findings.push(m.id + ": note Memory must remain captured");
      if (m.state === "superseded") {
        if (m.resolution !== undefined) findings.push(m.id + ": superseded Memory cannot retain resolution");
        if (m.supersededBy !== undefined && byRef.get(m.supersededBy)?.memoryKind !== m.memoryKind) findings.push(m.id + ": supersededBy must be same-kind or absent");
        if (m.promotions.length > 0) findings.push(m.id + ": superseded Memory must have no current promotions");
      }
      if (m.supersededBy !== undefined && byRef.get(m.supersededBy) === undefined) findings.push(m.id + ": supersededBy target is missing");
      for (const target of m.promotions) try { this.validateTarget(snapshot, target); } catch (cause) { findings.push(m.id + ": " + message(cause)); }
      const seen = new Set<string>(); let cursor: MemoryMeta | undefined = m;
      while (cursor?.supersededBy !== undefined) {
        if (seen.has(cursor.id)) { findings.push(m.id + ": supersession cycle"); break; }
        seen.add(cursor.id); const next = byRef.get(cursor.supersededBy);
        if (next === undefined) break;
        if (next.memoryKind !== m.memoryKind) break;
        cursor = next;
      }
      if (m.resolution?.kind === "fixed" && m.resolution.evidenceLevel === "repository") {
        try {
          if (m.resolution.repositoryEvidence.epoch !== m.epoch || m.resolution.repositoryEvidence.memory !== "memory/" + m.id + ".md") throw new Error("repository evidence is not bound to the current Memory epoch/path");
          const current = this.validateFixedEvidence(snapshot, "memory/" + m.id + ".md", { requireOpen: false }).evidence;
          const { validatedAt: _storedAt, ...storedFacts } = m.resolution.repositoryEvidence;
          const { validatedAt: _currentAt, ...currentFacts } = current;
          if (canonical(storedFacts) !== canonical(currentFacts)) findings.push(m.id + ": repository evidence facts changed; re-resolve with current evidence");
        } catch (cause) {
          const detail = message(cause); findings.push(m.id + ": " + (/missing|not found|unavailable|no current/u.test(detail) ? "unavailable: " : "repository evidence invalid: ") + detail);
        }
      }
    }
    this.#checkRegressionReferences(snapshot, findings);
    return { ok: findings.length === 0, checked: documents.length, findings };
  }
  #checkRegressionReferences(snapshot: TraceSnapshot, findings: string[]): void {
    const byPath = new Map(snapshot.memory.map((memory) => [memory.path, memory]));
    for (const test of snapshot.tests) for (const reference of test.regressions) {
      const target = byPath.get(reference.split("#", 1)[0] ?? reference);
      if (target === undefined) findings.push(test.selector + ": regression Memory " + reference + " is missing");
      else if (target.kind !== "problem") findings.push(test.selector + ": regression must reference Problem Memory");
    }
  }
}
export const memoryEffect = <A>(operation: string, thunk: () => A): Effect.Effect<A, MemoryError> => Effect.try({ try: thunk, catch: (cause) => cause instanceof MemoryFileMissing || cause instanceof MemoryContentInvalid || cause instanceof MemoryReferenceConflict || cause instanceof MemoryIoError ? cause : new MemoryIoError({ operation, message: message(cause) }) });
