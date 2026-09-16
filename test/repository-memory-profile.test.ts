import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { deriveTestReference } from "../dist/test-reference.js";

import { decode, MemorySchema, RepositoryEvidenceSchema, type MemoryMeta } from "concord-sdlc/model";
import { Result } from "effect";
import { activateMemory, promoteMemory, supersedeMemory } from "../dist/repository/memory/state.js";
import { buildRepositorySourceIdentity } from "../dist/repository/source-identity.js";
import { encodeMemoryDocument } from "../dist/repository/memory/codec.js";
import { MemoryRepository } from "../dist/repository/memory/repository.js";
import type { TraceSnapshot } from "../dist/repository/docs/trace/model.js";

function memory(id: string, memoryKind: "problem" | "decision" | "note", state: "open" | "current" | "captured" | "resolved", extra: Record<string, unknown> = {}): MemoryMeta {
  return decode(MemorySchema, { format: "concord.document/v1", id, title: id, createdAt: "2026-09-14T00:00:00.000Z", kind: "memory", memoryKind, state, epoch: 0, promotions: [], history: [], ...extra }, "test memory");
}

test("repository supersede records canonical path and independent commit metadata", () => {
  const source = memory("old", "decision", "current");
  const replacement = memory("new", "decision", "current");
  const commit = "0123456789012345678901234567890123456789";
  const changed = supersedeMemory(source, replacement, "memory/new.md", "No longer applicable", "2026-09-14T12:00:00.000Z", commit);
  assert.equal(Result.isSuccess(changed), true);
  if (Result.isSuccess(changed)) {
    assert.equal(changed.success.supersededBy, "memory/new.md");
    assert.equal(changed.success.history.at(-1)?.at, "2026-09-14T12:00:00.000Z");
    assert.equal(changed.success.history.at(-1)?.commit, commit);
  }
});

test("Problem Memory can supersede an active Problem and retains its full resolution in history", () => {
  const sourceResolution = { kind: "not-a-bug" as const, reason: "resolved source", at: "2026-09-14T11:00:00.000Z", epoch: 0, evidenceLevel: "author" as const };
  const source = memory("old-problem", "problem", "resolved", { resolution: sourceResolution });
  const replacement = memory("new-problem", "problem", "open");
  const changed = supersedeMemory(source, replacement, "memory/new-problem.md", "superseded by current problem", "2026-09-14T12:00:00.000Z");
  assert.equal(Result.isSuccess(changed), true);
  if (Result.isSuccess(changed)) {
    assert.equal(changed.success.state, "superseded");
    assert.equal(changed.success.supersededBy, "memory/new-problem.md");
    assert.deepEqual(changed.success.history.at(-1)?.resolution, sourceResolution);
  }
});

test("promotion history keeps actual event time and independent commit", () => {
  const source = memory("promoted", "decision", "current");
  const commit = "0123456789012345678901234567890123456789";
  const changed = promoteMemory(source, "docs/feature/example/README.md", "2026-09-14T12:34:56.000Z", commit);
  assert.equal(Result.isSuccess(changed), true);
  if (Result.isSuccess(changed)) {
    assert.deepEqual(changed.success.promotions, ["docs/feature/example/README.md"]);
    assert.equal(changed.success.history.at(-1)?.at, "2026-09-14T12:34:56.000Z");
    assert.equal(changed.success.history.at(-1)?.commit, commit);
  }
});

test("activate changes captured classified Memory state and rejects note", () => {
  const commit = "0123456789012345678901234567890123456789";
  const problem = activateMemory(memory("captured-problem", "problem", "captured"), "triaged", "2026-09-14T12:00:00.000Z", commit);
  assert.equal(Result.isSuccess(problem), true);
  if (Result.isSuccess(problem)) {
    assert.equal(problem.success.state, "open");
    assert.equal(problem.success.history.at(-1)?.reason, "triaged");
    assert.equal(problem.success.history.at(-1)?.commit, commit);
  }
  const decision = activateMemory(memory("captured-decision", "decision", "captured"), "adopted", "2026-09-14T12:00:00.000Z", commit);
  assert.equal(Result.isSuccess(decision), true);
  if (Result.isSuccess(decision)) assert.equal(decision.success.state, "current");
  assert.equal(Result.isFailure(activateMemory(memory("captured-note", "note", "captured"), "no", "2026-09-14T12:00:00.000Z")), true);
});

test("repository Memory list ignores navigation README", () => {
  const root = mkdtempSync(join(tmpdir(), "concord-memory-list-"));
  try {
    mkdirSync(join(root, "memory"));
    writeFileSync(join(root, "memory", "README.md"), "navigation only\n");
    writeFileSync(join(root, "memory", "kept.md"), "---\nformat: concord.document/v1\nid: kept\ntitle: Kept\ncreatedAt: 2026-09-14T00:00:00.000Z\nkind: memory\nmemoryKind: note\nstate: captured\nepoch: 0\npromotions: []\nhistory: []\n---\nbody\n");
    assert.deepEqual(new MemoryRepository(root).list().map((item) => item.metadata.id), ["kept"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository targetSource rejects symlink path components", () => {
  const root = mkdtempSync(join(tmpdir(), "concord-memory-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "concord-memory-outside-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(outside, "target.md"), "outside\n");
    symlinkSync(outside, join(root, "docs", "linked"));
    assert.throws(() => new MemoryRepository(root).targetSource("docs/linked/target.md"), /symlink/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("repository Memory owner reads reject symlink owners", () => {
  const root = mkdtempSync(join(tmpdir(), "concord-memory-owner-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "concord-memory-owner-outside-"));
  try {
    mkdirSync(join(root, "memory"));
    writeFileSync(join(outside, "source.md"), "---\nformat: concord.document/v1\nid: source\ntitle: Source\ncreatedAt: 2026-09-14T00:00:00.000Z\nkind: memory\nmemoryKind: note\nstate: captured\nepoch: 0\npromotions: []\nhistory: []\n---\n");
    symlinkSync(join(outside, "source.md"), join(root, "memory", "source.md"));
    assert.throws(() => new MemoryRepository(root).read("source"), /symlink/u);
    assert.equal(existsSync(join(root, "memory", "source.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

const rawDigest = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value) ?? "null";
const signature = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const inventoryDigest = (value: unknown): string => `sha256:${signature(value)}`;
const jsonBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function formalFixture() {
  const root = mkdtempSync(join(tmpdir(), "concord-memory-formal-"));
  const project = join(root, "e2e/fixture");
  const nativeTest = "e2e/fixture/test/native.test.ts";
  const helper = "e2e/fixture/test/helper.scenarios.ts";
  const caseId = deriveTestReference(nativeTest, helper, "fixture");
  const selector = `${nativeTest}#${caseId}`;
  mkdirSync(join(project, "test"), { recursive: true });
  mkdirSync(join(root, "docs/engineering/testing/e2e"), { recursive: true });
  mkdirSync(join(root, "docs/feature/fixture/use-case"), { recursive: true });
  mkdirSync(join(root, "memory"), { recursive: true });
  writeFileSync(join(project, "project.json"), "{}\n");
  writeFileSync(join(root, "docs/feature/fixture/use-case/run.md"), "# Run fixture\n");
  writeFileSync(join(project, "test/native.test.ts"), "import './helper.scenarios.js';\n");
  writeFileSync(join(project, "test/helper.scenarios.ts"), `import { test } from "vitest";
// @use-case docs/feature/fixture/use-case/run.md
// @test-file ${nativeTest}
test("fixture", () => {});
`);
  const memoryMeta = memory("problem", "problem", "open");
  writeFileSync(join(root, "memory/problem.md"), encodeMemoryDocument(memoryMeta, "Problem body\n"));
  const source = buildRepositorySourceIdentity({ repositoryRoot: root, projectRoot: project, caseId, nativeTestFile: nativeTest, contractRef: "docs/feature/fixture/use-case/run.md" });
  const inventoryUnsigned = {
    executor: { name: "vitest", version: "1.0.0" }, repo: "fixture", argv: ["vitest", nativeTest], checkout: "0123456789012345678901234567890123456789", files: [nativeTest],
    cases: [{ executor: "vitest", repo: "fixture", path: nativeTest, titlePath: ["fixture"], caseId }], unassignedCases: [], bodyExecutions: 0, forbiddenSetupExecutions: 0, findings: [], exit: 0, signal: null,
  };
  const inventory = { ...inventoryUnsigned, digest: inventoryDigest(inventoryUnsigned) };
  const candidate = { gitSha: inventoryUnsigned.checkout, sha256: "sha256:" + "a".repeat(64), sri: "sha256-" + "a".repeat(43) };
  const receiptPaths = { red: "evidence/red.json", green: "evidence/green.json", isolated1: "evidence/reliability-1.json", isolated2: "evidence/reliability-2.json", isolated3: "evidence/reliability-3.json", same1: "evidence/reliability-4.json", same2: "evidence/reliability-5.json", parallel: "evidence/reliability-6.json" };
  const makeReceipt = (observation: "red" | "green" | "reliability", disposition: "regression" | "pass", invocationId: string) => {
    const unsigned = { format: "niceeval.e2e-case-receipt/v2", mode: "formal", observation, selector, caseId, inventoryDigest: inventory.digest, candidate, source, runner: { executor: "vitest", version: "1.0.0", argv: ["vitest", nativeTest] }, result: { disposition, stage: "test", exitCode: 0, signal: null }, cleanup: { ok: true, resources: [{}] }, invocationId };
    return { ...unsigned, receiptSha256: signature(unsigned) };
  };
  const receipts: Record<string, unknown> = {
    red: makeReceipt("red", "regression", "inv-red"), green: makeReceipt("green", "pass", "inv-green"),
    isolated1: makeReceipt("reliability", "pass", "inv-r1"), isolated2: makeReceipt("reliability", "pass", "inv-r2"), isolated3: makeReceipt("reliability", "pass", "inv-r3"),
    same1: makeReceipt("reliability", "pass", "inv-r4"), same2: makeReceipt("reliability", "pass", "inv-r5"), parallel: makeReceipt("reliability", "pass", "inv-r6"),
  };
  const certificateUnsigned = { format: "niceeval.e2e-takeover-certificate/v2", selector, caseId, candidateSha256: candidate.sha256, sourceDigest: source.projection.digest, greenReceipt: receiptPaths.green, observations: { isolatedCopies: [receiptPaths.isolated1, receiptPaths.isolated2, receiptPaths.isolated3], sameCopy: [receiptPaths.same1, receiptPaths.same2], defaultParallel: receiptPaths.parallel, singleCase: receiptPaths.green, cleanup: ["clean"] } };
  const certificate = { ...certificateUnsigned, certificateSha256: signature(certificateUnsigned) };
  const evidenceRoot = join(root, "evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  for (const [name, receipt] of Object.entries(receipts)) writeFileSync(join(root, receiptPaths[name as keyof typeof receiptPaths]), jsonBytes(receipt));
  writeFileSync(join(root, "evidence/certificate.json"), jsonBytes(certificate));
  writeFileSync(join(root, "evidence/inventory.json"), jsonBytes(inventory));
  const evidence = { red: { path: receiptPaths.red, digest: rawDigest(jsonBytes(receipts.red)) }, green: { path: receiptPaths.green, digest: rawDigest(jsonBytes(receipts.green)) }, certificate: { path: "evidence/certificate.json", digest: rawDigest(jsonBytes(certificate)) }, inventory: { path: "evidence/inventory.json", digest: inventory.digest } };
  writeFileSync(join(project, "test/native.test.ts.cases.evidence.json"), jsonBytes({ format: "niceeval.e2e-case-evidence-index/v1", current: { [caseId]: { "memory/problem.md": evidence } } }));
  const snapshot: TraceSnapshot = { digest: "snapshot", generation: 1, nodes: [], pages: [], owners: [], tests: [{ caseId, selector, path: nativeTest, title: "fixture", repo: "fixture", contract: "docs/feature/fixture/use-case/run.md", regressions: ["memory/problem.md"], issues: [], lane: [], areas: [], executor: { kind: "vitest" } }], feedback: [], memory: [{ path: "memory/problem.md", id: "problem", title: "problem", kind: "problem", state: "open", promotions: [{ kind: "promotion", current: [], history: [] }] }] };
  return { root, project, repo: new MemoryRepository(root), snapshot, memoryMeta, paths: { ...receiptPaths, inventory: "evidence/inventory.json", certificate: "evidence/certificate.json" }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("formal repository evidence resolves and check revalidates a complete current gate", () => {
  const fixture = formalFixture();
  try {
    const validation = fixture.repo.validateFixedEvidence(fixture.snapshot, "memory/problem.md");
    const planned = fixture.repo.planResolve("problem", readFileSync(join(fixture.root, "memory/problem.md"), "utf8"), { kind: "fixed", reason: "formal gate", at: "2026-09-14T12:00:00.000Z" }, validation.evidence, "0123456789012345678901234567890123456789");
    writeFileSync(join(fixture.root, "memory/problem.md"), planned.bytes);
    assert.equal(fixture.repo.check(fixture.snapshot).ok, true);
    const reopened = fixture.repo.planReopen("problem", planned.bytes, "reopen", "2026-09-14T13:00:00.000Z", "0123456789012345678901234567890123456789");
    writeFileSync(join(fixture.root, "memory/problem.md"), reopened.bytes);
    const moved = decode(RepositoryEvidenceSchema, { ...validation.evidence, cases: validation.evidence.cases.map((item) => ({ ...item, red: { ...item.red, path: "evidence/moved-red.json" } })) }, 'moved historical evidence');
    assert.throws(() => fixture.repo.planResolve("problem", reopened.bytes, { kind: "fixed", reason: "again", at: "2026-09-14T14:00:00.000Z" }, moved, "0123456789012345678901234567890123456789"), /invocation identities were already used/u);
  } finally { fixture.cleanup(); }
});

test("formal gate rejects inventory signature, setup execution, certificate CAS, and duplicate invocation", () => {
  const mutate = (change: (fixture: ReturnType<typeof formalFixture>) => void, expected: RegExp) => {
    const fixture = formalFixture();
    try { change(fixture); assert.throws(() => fixture.repo.validateFixedEvidence(fixture.snapshot, "memory/problem.md"), expected); } finally { fixture.cleanup(); }
  };
  mutate((fixture) => {
    const path = join(fixture.root, fixture.paths.inventory); const inventory = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; inventory.digest = "sha256:" + "0".repeat(64); writeFileSync(path, jsonBytes(inventory));
  }, /inventory is not a clean|invalid or incomplete/u);
  mutate((fixture) => {
    const path = join(fixture.root, fixture.paths.inventory); const inventory = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; inventory.bodyExecutions = 1; const unsigned = { ...inventory }; delete unsigned.digest; inventory.digest = inventoryDigest(unsigned); writeFileSync(path, jsonBytes(inventory));
  }, /invalid or incomplete fixed evidence|inventory is not a clean/u);
  mutate((fixture) => {
    const path = join(fixture.root, fixture.paths.certificate); const certificate = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; certificate.certificateSha256 = "0".repeat(64); writeFileSync(path, jsonBytes(certificate));
  }, /evidence index digest does not match certificate bytes/u);
  mutate((fixture) => {
    const path = join(fixture.root, fixture.paths.parallel); const receipt = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; receipt.invocationId = "inv-red"; const unsigned = { ...receipt }; delete unsigned.receiptSha256; receipt.receiptSha256 = signature(unsigned); writeFileSync(path, jsonBytes(receipt));
  }, /eight distinct invocation identities/u);
});
