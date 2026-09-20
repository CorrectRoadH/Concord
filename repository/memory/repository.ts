import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Effect, Result, Schema } from "effect";
import { ConcordError, decode, RepositoryEvidenceSchema, type MemoryMeta, type RepositoryEvidence } from "concord-sdlc/model";
import { parseRepoRef, validateRepoRefTarget, type ValidatedRepoRefTarget } from "../docs/trace/ref.js";
import { ADOPTABLE_DOCS_NODE_KINDS, type TraceSnapshot } from "../docs/trace/model.js";
import { traceDigest } from "../docs/trace/relation-mutation.js";
import { readGovernanceConfiguration, governanceSuiteForFile } from "concord-sdlc/governance-config";
import { adoptMemoryEvidenceRequirement, validateNativeEvidence, decodeNativeEvidenceIndex, NativeReliabilityCertificateSchema, evidenceSignature, usedMemoryInvocations } from "concord-sdlc/evidence-policy";
import { decodeMemoryDocument, encodeMemoryDocument } from "./codec.js";
import { MemoryContentInvalid, MemoryFileMissing, MemoryIoError, MemoryReferenceConflict, EvidenceMigrationRequired, type MemoryError } from "./errors.js";
import type { MemoryDocument, ProblemResolutionIntent, PromotionKind } from "./schema.js";
import { activateMemory, promoteMemory, reopenProblem, resolveProblem, retirePromotion, supersedeMemory } from "./state.js";
import { decodeRepositorySourceIdentityV4, resolveRepositorySourceIdentity, sameRepositorySourceIdentity } from "../source-identity.js";

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const canonical = (value: unknown): string => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" :
  value !== null && typeof value === "object" ? "{" + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}" : JSON.stringify(value);

export interface MemoryCheckReceipt { readonly ok: boolean; readonly checked: number; readonly findings: readonly string[] }
export interface MemoryAuthorSnapshot { readonly document: MemoryDocument; readonly ownerPreimageDigest: string; readonly authorRegionDigest: string }
export interface FixedEvidenceValidation { readonly selectors: readonly string[]; readonly preimagePaths: readonly string[]; readonly preimageDigests: Readonly<Record<string, string>>; readonly evidence: RepositoryEvidence }

function authorRegion(body: string): string { return body; }
function decodeJson(path: string, source: string): unknown { try { return JSON.parse(source); } catch (cause) { throw new MemoryReferenceConflict({ operation: "resolve", path, message: "invalid evidence JSON: " + message(cause) }); } }
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
    metadata = adoptMemoryEvidenceRequirement(metadata, readGovernanceConfiguration(this.#root)?.config.policy);
    this.#guardId(metadata.id);
    if (metadata.promotions.length !== 0 || metadata.history.length !== 0 || metadata.resolution !== undefined || metadata.supersededBy !== undefined || metadata.supersession !== undefined) throw new MemoryReferenceConflict({ operation: "add", message: "new Memory has no history, resolution, promotion, or supersession" });
    const valid = metadata.memoryKind === "problem" ? metadata.state === "open" : metadata.memoryKind === "note" ? metadata.state === "captured" : metadata.state === "current";
    if (!valid || existsSync(this.absoluteOwnerPath(metadata.id))) throw new MemoryReferenceConflict({ operation: "add", path: this.ownerPath(metadata.id), message: "invalid initial Memory state or existing owner" });
    return { bytes: encodeMemoryDocument(metadata, body), metadata };
  }
  planTransition(id: string, source: string | undefined, transition: (value: MemoryMeta) => Result.Result<MemoryMeta, MemoryReferenceConflict>) {
    if (source === undefined) throw new MemoryFileMissing({ operation: "mutate", path: this.ownerPath(id), message: "not found" });
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    const result = transition(adoptMemoryEvidenceRequirement(document.metadata, readGovernanceConfiguration(this.#root)?.config.policy));
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
  validateFixedEvidence(snapshot: TraceSnapshot, memoryPath: string, options: { readonly requireOpen?: boolean; readonly implementationDigest?: string; readonly validatedAt?: string } = {}): FixedEvidenceValidation {
    if (options.implementationDigest === undefined) throw new MemoryReferenceConflict({ operation: "resolve", path: memoryPath, message: "current native implementation digest is unavailable; request the host capability" });
    const related = snapshot.tests.filter((test) => test.regressions.some((reference) => reference.split("#", 1)[0] === memoryPath));
    const memoryId = memoryPath.slice("memory/".length, -3); const owner = this.readAuthorSnapshot(memoryId); const memory = owner.document.metadata;
    if (memory.memoryKind !== "problem" || (options.requireOpen !== false && memory.state !== "open")) throw new MemoryReferenceConflict({ operation: "resolve", path: memoryPath, message: "fixed gate requires the current open Problem Memory" });
    if (related.length === 0) throw new MemoryReferenceConflict({ operation: "resolve", path: memoryPath, message: "fixed gate requires a current regression case" });
    const preimages = new Set<string>([memoryPath]); const cases: unknown[] = [];
    const preimageDigests: Record<string, string> = { [memoryPath]: owner.ownerPreimageDigest };
    const capture = (path: string, digest: string): void => {
      if (preimageDigests[path] !== undefined && preimageDigests[path] !== digest) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "evidence dependency changed during validation" });
      preimages.add(path); preimageDigests[path] = digest;
    };
    for (const test of related) {
      const indexPath = test.path + ".cases.evidence.json";
      const indexSource = this.targetSource(indexPath).source; capture(indexPath, traceDigest(indexSource));
      const index = decodeNativeEvidenceIndex(decodeJson(indexPath, indexSource), indexPath);
      preimages.add(indexPath); const entry = index.current[test.caseId]?.[memoryPath];
      if (entry === undefined) throw new MemoryReferenceConflict({ operation: "resolve", path: indexPath, message: "no current evidence for selector and Memory" });
      const config = readGovernanceConfiguration(this.#root);
      const suite = governanceSuiteForFile(this.#root, test.path);
      if (config === undefined || suite === undefined) throw new MemoryReferenceConflict({ operation: "resolve", path: test.path, message: "native evidence requires current governance suite configuration" });
      capture(config.path, config.digest);
      const currentSource = resolveRepositorySourceIdentity(this.#root, test.selector);
      if (currentSource.binding.configurationDigest !== config.digest) throw new MemoryReferenceConflict({ operation: "resolve", path: config.path, message: "policy configuration changed during validation" });
      capture(currentSource.binding.contractRef.split("#", 1)[0]!, "sha256:" + currentSource.binding.contractSha256);
      for (const file of currentSource.projection.files) capture(file.path, "sha256:" + file.rawSha256);
      if (config.config.host !== undefined && currentSource.binding.adapterSourceDigest !== null) capture(config.config.host, currentSource.binding.adapterSourceDigest);
      const sources = new Map<string, string>();
      const readEvidence = (file: { readonly path: string; readonly digest?: string }, inventory = false): unknown => {
        const raw = this.targetSource(file.path).source;
        capture(file.path, traceDigest(raw)); sources.set(file.path, raw);
        if (!inventory && file.digest !== undefined && traceDigest(raw) !== file.digest) throw new MemoryReferenceConflict({ operation: "resolve", path: file.path, message: "evidence digest mismatch" });
        return decodeJson(file.path, raw);
      };
      const certificate = checked(entry.certificate.path, NativeReliabilityCertificateSchema, readEvidence(entry.certificate));
      const paths = [...certificate.observations.isolatedCopies, ...certificate.observations.sameCopy, certificate.observations.defaultParallel];
      if (certificate.greenReceipt !== entry.green.path) throw new MemoryReferenceConflict({ operation: "resolve", path: indexPath, message: "certificate green receipt differs from index" });
      const receipts = new Map<string, unknown>([[entry.green.path, readEvidence(entry.green)], ...paths.map(path => [path, readEvidence({ path })] as const)]);
      const verified = validateNativeEvidence({ inventory: readEvidence(entry.inventory, true), red: readEvidence(entry.red), certificate, receipts }, {
        selector: test.selector, problem: { path: memoryPath, epoch: memory.epoch }, currentSource, implementationDigest: options.implementationDigest,
        decodeSource: decodeRepositorySourceIdentityV4, sameSource: sameRepositorySourceIdentity,
        usedInvocations: options.requireOpen === false ? [] : usedMemoryInvocations(memory),
      });
      if (verified.inventory.digest !== entry.inventory.digest) throw new MemoryReferenceConflict({ operation: "resolve", path: entry.inventory.path, message: "inventory index digest mismatch" });
      const file = (path: string) => ({ path, digest: traceDigest(sources.get(path)!) });
      cases.push({ selector: test.selector, caseId: test.caseId,
        binding: { kind: currentSource.binding.kind, contractRef: currentSource.binding.contractRef, contractSha256: currentSource.binding.contractSha256 },
        sourceIdentityDigest: evidenceSignature(currentSource), sourceDigest: currentSource.projection.digest, candidateSha256: verified.green.candidate.sha256,
        red: file(entry.red.path), green: file(entry.green.path), certificate: file(entry.certificate.path), inventory: file(entry.inventory.path), reliability: paths.map(file), invocationIds: verified.invocationIds });
    }
    const evidence = decode(RepositoryEvidenceSchema, { policy: "concord.native-reliability/v1", memory: memoryPath, epoch: memory.epoch, validatedAt: options.validatedAt ?? new Date().toISOString(), cases }, memoryPath);
    for (const [path, expected] of Object.entries(preimageDigests)) if (traceDigest(this.targetSource(path).source) !== expected) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "evidence dependency changed during validation" });
    return { selectors: related.map((test) => test.selector).sort(), preimagePaths: [...preimages].sort(), preimageDigests, evidence };
  }
  search(pattern: string): readonly MemoryDocument[] { const needle = pattern.toLocaleLowerCase(); return this.list().filter((item) => (item.metadata.id + "\n" + item.metadata.title + "\n" + item.body).toLocaleLowerCase().includes(needle)); }
  check(snapshot: TraceSnapshot, implementationDigest?: string): MemoryCheckReceipt {
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
      if (m.resolution?.kind === "fixed" && m.resolution.evidenceLevel === "command" && adoptMemoryEvidenceRequirement(m).evidenceRequirement === "concord.native-reliability/v1") findings.push(m.id + ": command evidence does not satisfy the persisted native requirement");
      if (m.resolution?.kind === "fixed" && m.resolution.evidenceLevel === "repository") {
        try {
          if (m.resolution.repositoryEvidence.epoch !== m.epoch || m.resolution.repositoryEvidence.memory !== "memory/" + m.id + ".md") throw new Error("repository evidence is not bound to the current Memory epoch/path");
          const current = this.validateFixedEvidence(snapshot, "memory/" + m.id + ".md", { requireOpen: false, ...(implementationDigest === undefined ? {} : { implementationDigest }) }).evidence;
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
export const memoryEffect = <A>(operation: string, thunk: () => A): Effect.Effect<A, MemoryError> => Effect.try({ try: thunk, catch: (cause) => cause instanceof ConcordError && cause.code === "EvidenceMigrationRequired" ? new EvidenceMigrationRequired({ operation, message: cause.message }) : cause instanceof EvidenceMigrationRequired || cause instanceof MemoryFileMissing || cause instanceof MemoryContentInvalid || cause instanceof MemoryReferenceConflict || cause instanceof MemoryIoError ? cause : new MemoryIoError({ operation, message: message(cause) }) });
