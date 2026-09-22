import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Effect } from "effect";
import { renderTypeScriptConfig } from '../src/config.js';
import { LocalRepository } from "../src/storage.js";
import { acquireTraceLeaseSync, genericJournalPath, genericPrivateDirectorySync, releaseTraceLeaseSync, tracePrivateDirectorySync } from "../src/coordination.js";
import { mutateTraceFiles, recoverTrace, traceDigest, withTraceReadLease } from "../repository/docs/trace/relation-mutation.js";
import { TraceJournalMigrationRequired, TraceRecoveryRequired } from "../repository/docs/trace/errors.js";

function isolatedRepository(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "concord-coordination-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "concord.config.ts"), renderTypeScriptConfig({ format: "concord.project/v1", projectId: "coordination-test", testRoots: ["test"], runner: { kind: "node-test", sourceFiles: [], timeoutMs: 60000 } }));
  execFileSync("git", ["-C", root, "add", "concord.config.ts"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Concord Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  return root;
}

test("generic and Trace operations share one portable publication lease", (t) => {
  const root = isolatedRepository(t);
  const lease = acquireTraceLeaseSync(root, "exclusive", "test-hold", true);
  assert.throws(() => new LocalRepository(root, { dryRun: true }), { code: "RepositoryBusy" });
  assert.throws(() => acquireTraceLeaseSync(root, "shared", "test-shared", true), /busy|lease/i);
  releaseTraceLeaseSync(lease!, "test-release");
  const repository = new LocalRepository(root, { dryRun: true });
  repository.close();
});

test("the shared lease also excludes a separate Node process", async (t) => {
  const root = isolatedRepository(t);
  const child = spawn(process.execPath, ["--import", "tsx", "--eval", `import { acquireTraceLeaseSync, releaseTraceLeaseSync } from './src/coordination.ts'; const lease = acquireTraceLeaseSync(process.argv[1], 'exclusive', 'child-hold', true); console.log('ready'); process.stdin.once('data', () => { if (lease) releaseTraceLeaseSync(lease, 'child-release'); });`, root], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", (data) => data.toString().includes("ready") ? resolve() : reject(new Error(`unexpected child output: ${data}`)));
      child.once("error", reject);
    });
    assert.throws(() => new LocalRepository(root, { dryRun: true }), /busy|lease/i);
  } finally {
    child.stdin.end();
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
});

test("multi-file deletion journals and recovers an interrupted transaction", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "docs.md"), "before\n");
  const before = traceDigest("before\n");
  await assert.rejects(
    Effect.runPromise(mutateTraceFiles({ root, operation: "delete-fixture", changes: [{ path: "docs.md", bytes: null, expectedDigest: before }], injectFailureAfterRename: 1 })),
    /injected interruption/,
  );
  assert.equal(readFileSync(join(tracePrivateDirectorySync(root), "multi-file-publication-journal.json"), "utf8").includes('"kind":"absent"'), true);
  const recovered = JSON.parse(execFileSync(process.execPath, ['dist/entry.js', '--root', root, '--json', 'recover'], { encoding: 'utf8' })) as { status: string; receipt: { recovered: boolean } };
  assert.equal(recovered.status, 'trace-recovered');
  const receipt = recovered.receipt;
  assert.equal(receipt.recovered, true);
  assert.equal(readFileSync(join(root, "docs.md"), "utf8"), "before\n");
  assert.equal((await Effect.runPromise(recoverTrace(root))).recovered, false);
  const repository = new LocalRepository(root, { dryRun: true });
  assert.equal(repository.config.projectId, "coordination-test");
  repository.close();
});

test("generation-committed recovery verifies the planned deletion and is repeatable", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "docs.md"), "before\n");
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "delete-after-generation", changes: [{ path: "docs.md", bytes: null, expectedDigest: traceDigest("before\n") }], injectFailureAfterGeneration: true })), /injected interruption/);
  assert.throws(() => readFileSync(join(root, "docs.md"), "utf8"), /ENOENT/);
  assert.equal((await Effect.runPromise(recoverTrace(root))).recovered, true);
  assert.throws(() => readFileSync(join(root, "docs.md"), "utf8"), /ENOENT/);
  assert.equal((await Effect.runPromise(recoverTrace(root))).recovered, false);
});

test("unknown edits preserve the interrupted transaction for conflict inspection", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "docs.md"), "before\n");
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "delete-conflict", changes: [{ path: "docs.md", bytes: null, expectedDigest: traceDigest("before\n") }], injectFailureAfterRename: 1 })), /injected interruption/);
  writeFileSync(join(root, "docs.md"), "unknown edit\n");
  await assert.rejects(Effect.runPromise(recoverTrace(root)), /neither its recorded preimage nor planned image/);
  assert.equal(readFileSync(join(root, "docs.md"), "utf8"), "unknown edit\n");
});

test("old multi-file journal format is rejected by strict recovery", async (t) => {
  const root = isolatedRepository(t);
  const directory = tracePrivateDirectorySync(root);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "multi-file-publication-journal.json"), JSON.stringify({ format: "niceeval.docs-trace/multi-file-publication-journal/v1", files: [] }));
  await assert.rejects(Effect.runPromise(recoverTrace(root)), (cause) => cause instanceof TraceJournalMigrationRequired);
});

test("a mixed write/delete transaction validates every temp before rolling back any target", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "delete.md"), "before\n");
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "mixed-conflict", changes: [
    { path: "write.md", bytes: "planned\n" },
    { path: "delete.md", bytes: null, expectedDigest: traceDigest("before\n") },
  ], injectFailureAfterRename: 1 })), /injected interruption/);
  const journalPath = join(tracePrivateDirectorySync(root), "multi-file-publication-journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { files: readonly { path: string; temporary: string }[] };
  const deleteEntry = journal.files.find((file) => file.path === "delete.md")!;
  writeFileSync(join(root, deleteEntry.temporary), "tampered temporary\n");
  await assert.rejects(Effect.runPromise(recoverTrace(root)), /temporary exists for an absent planned image|temporary is neither absent nor its planned image/);
  assert.equal(readFileSync(join(root, "write.md"), "utf8"), "planned\n");
  assert.equal(readFileSync(join(root, "delete.md"), "utf8"), "before\n");
});

test("v2 journal path, temporary, digest, and generation tampering is rejected before recovery", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "journal.md"), "before\n");
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "journal-tamper", changes: [{ path: "journal.md", bytes: "after\n" }], injectFailureAfterRename: 1 })), /injected interruption/);
  const journalPath = join(tracePrivateDirectorySync(root), "multi-file-publication-journal.json");
  const original = JSON.parse(readFileSync(journalPath, "utf8")) as { newGeneration: number; files: Array<{ path: string; temporary: string; preimage: { kind: string; digest?: string } }> };
  const variants = [
    (value: typeof original) => { value.files[0]!.temporary = "journal.md.wrong.tmp"; },
    (value: typeof original) => { value.files[0]!.path = "../outside.md"; },
    (value: typeof original) => { value.files[0]!.preimage.digest = "sha256:" + "0".repeat(64); },
    (value: typeof original) => { (value.files[0]!.preimage as { kind: string; bytesBase64?: string }).bytesBase64 = "AAAA garbage"; },
    (value: typeof original) => { value.newGeneration += 2; },
  ];
  for (const mutate of variants) {
    const candidate = structuredClone(original);
    mutate(candidate);
    writeFileSync(journalPath, JSON.stringify(candidate));
    await assert.rejects(Effect.runPromise(recoverTrace(root)), /temporary path|unsafe|index entries and files differ|preimage does not match|generations are not consecutive/);
    writeFileSync(journalPath, JSON.stringify(original));
  }
  assert.equal(readFileSync(join(root, "journal.md"), "utf8"), "after\n");
});

test("generic and both Trace journals block ordinary reads/writes and cross-recovery", async (t) => {
  const root = isolatedRepository(t);
  const traceDirectory = tracePrivateDirectorySync(root);
  mkdirSync(traceDirectory, { recursive: true });
  const traceJournal = join(traceDirectory, "publication-journal.json");
  const genericJournal = genericJournalPath(root);
  mkdirSync(genericPrivateDirectorySync(root), { recursive: true });
  writeFileSync(traceJournal, "{}\n");
  assert.throws(() => new LocalRepository(root, { dryRun: true }), /Trace publication/);
  await assert.rejects(Effect.runPromise(withTraceReadLease(root, () => Effect.succeed(true))), (cause) => cause instanceof TraceRecoveryRequired);
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "blocked-by-trace", changes: [{ path: "blocked.md", bytes: "nope" }] })), (cause) => cause instanceof TraceRecoveryRequired);
  writeFileSync(genericJournal, JSON.stringify({ format: "concord.journal", root, privateDir: genericPrivateDirectorySync(root), projectId: "coordination-test", operation: "pending", phase: "prepared", directories: [], changes: [], scope: { kind: "documents", configPath: "concord.config.ts", configSource: "", configDigest: "sha256:pending" } }));
  await assert.rejects(Effect.runPromise(recoverTrace(root)), (cause) => cause instanceof TraceRecoveryRequired && cause.nextStep === "concord recover");
  assert.throws(() => new LocalRepository(root, { recover: true }), /Trace publication/);
  rmSync(traceJournal);
  await assert.rejects(Effect.runPromise(withTraceReadLease(root, () => Effect.succeed(true))), (cause) => cause instanceof TraceRecoveryRequired && cause.nextStep === "concord recover");
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "blocked-by-generic", changes: [{ path: "blocked.md", bytes: "nope" }] })), (cause) => cause instanceof TraceRecoveryRequired && cause.nextStep === "concord recover");
});

test("private coordination paths reject symlinked Trace and generic directories", (t) => {
  const traceRoot = isolatedRepository(t);
  mkdirSync(join(traceRoot, ".git", "concord"), { recursive: true });
  symlinkSync(traceRoot, join(traceRoot, ".git", "concord", "trace"));
  assert.throws(() => acquireTraceLeaseSync(traceRoot, "shared", "symlink-trace", true), /symbolic links/);
  const genericRoot = isolatedRepository(t);
  mkdirSync(join(genericRoot, ".git"), { recursive: true });
  symlinkSync(genericRoot, join(genericRoot, ".git", "concord"));
  assert.throws(() => new LocalRepository(genericRoot, { dryRun: true }), /symbolic links/);
  const journalRoot = isolatedRepository(t);
  mkdirSync(join(journalRoot, ".git", "concord"), { recursive: true });
  symlinkSync(journalRoot, join(journalRoot, ".git", "concord", "journal.json"));
  assert.throws(() => new LocalRepository(journalRoot, { dryRun: true }), /[Ss]ymbolic links/);
});

test("fresh repositories create only Concord private coordination state", (t) => {
  const root = isolatedRepository(t);
  const repository = new LocalRepository(root, { dryRun: true });
  repository.close();
  assert.equal(existsSync(join(root, ".git", "niceeval")), false);
  assert.equal(tracePrivateDirectorySync(root), join(root, ".git", "concord", "trace"));
});

test("ordinary runtime names and preserves unmigrated legacy coordination state", (t) => {
  const root = isolatedRepository(t);
  const legacy = join(root, ".git", "niceeval", "docs-trace");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "generation"), "4\n");
  assert.throws(() => new LocalRepository(root, { dryRun: true }), { code: "CoordinationMigrationRequired" });
  assert.equal(readFileSync(join(legacy, "generation"), "utf8"), "4\n");
  assert.equal(existsSync(join(root, ".git", "concord", "trace")), false);
});

test("governance configuration participates as a same-preimage guard without becoming a writable owner", (t) => {
  const root = isolatedRepository(t);
  mkdirSync(join(root, "docs", "feature", "guard"), { recursive: true });
  writeFileSync(join(root, "docs", "feature", "guard", "README.md"), "before\n");
  writeFileSync(join(root, "docs", "feature", "guard", "architecture.md"), "supporting guard\n");
  const repository = new LocalRepository(root);
  try {
    const receipt = repository.publish("guarded-write", [
      { path: "docs/feature/guard/README.md", before: "before\n", after: "after\n" },
      { path: "docs/feature/guard/architecture.md", before: "supporting guard\n", after: "supporting guard\n" },
      { path: "concord.repository.json", before: null, after: null },
    ]);
    assert.deepEqual(receipt.changedPaths, ["docs/feature/guard/README.md", "docs/feature/guard/architecture.md"]);
    assert.equal(readFileSync(join(root, "docs", "feature", "guard", "README.md"), "utf8"), "after\n");
    assert.equal(readFileSync(join(root, "docs", "feature", "guard", "architecture.md"), "utf8"), "supporting guard\n");
    assert.equal(existsSync(join(root, "concord.repository.json")), false);
    assert.throws(() => repository.publish("forbidden-governance-write", [{ path: "concord.repository.json", before: null, after: "{}\n" }]), /Governance configuration|Not a Concord document owner/);
  } finally { repository.close(); }
});

test("invalid generated mode or oversized bytes are rejected before a journal is durable", async (t) => {
  const root = isolatedRepository(t);
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "invalid-mode", changes: [{ path: "bad.md", bytes: "x", mode: 0x10000 }] })), /invalid mode/);
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "oversized", changes: [{ path: "bad.md", bytes: Buffer.alloc(32 * 1024 * 1024 + 1) }] })), /planned file exceeds|owner exceeds/);
  assert.throws(() => readFileSync(join(tracePrivateDirectorySync(root), "multi-file-publication-journal.json"), "utf8"), /ENOENT/);
});

test("full LocalRepository and Trace entry points exclude each other across processes", async (t) => {
  const root = isolatedRepository(t);
  const genericChild = spawn(process.execPath, ["--import", "tsx", "--eval", `import { LocalRepository } from './src/storage.ts'; const repository = new LocalRepository(process.argv[1]); repository.beginSnapshot(); console.log('ready'); process.stdin.once('data', () => repository.close());`, root], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (genericChild.exitCode === null) genericChild.kill("SIGTERM"); });
  try {
    await new Promise<void>((resolve, reject) => { genericChild.stdout.once("data", (data) => data.toString().includes("ready") ? resolve() : reject(new Error("generic child did not become ready"))); genericChild.once("error", reject); });
    await assert.rejects(Effect.runPromise(withTraceReadLease(root, () => Effect.succeed(true))), /busy|lease/i);
  } finally { genericChild.stdin.end("done"); await new Promise<void>((resolve) => genericChild.once("exit", () => resolve())); }

  const profileChild = spawn(process.execPath, ["--import", "tsx", "--eval", `import { Effect } from 'effect'; import { mutateTraceFiles } from './repository/docs/trace/relation-mutation.ts'; await Effect.runPromise(mutateTraceFiles({ root: process.argv[1], operation: 'hold-profile', prepareUnderLease: Effect.promise(() => { console.log('ready'); return new Promise((resolve) => process.stdin.once('data', () => resolve([{ path: 'held.md', bytes: 'held\\n' }]))); }) }));`, root], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (profileChild.exitCode === null) profileChild.kill("SIGTERM"); });
  try {
    await new Promise<void>((resolve, reject) => { profileChild.stdout.once("data", (data) => data.toString().includes("ready") ? resolve() : reject(new Error("profile child did not become ready"))); profileChild.once("error", reject); });
    assert.throws(() => new LocalRepository(root, { dryRun: true }), /busy|lease/i);
  } finally { profileChild.stdin.end("done"); await new Promise<void>((resolve) => profileChild.once("exit", () => resolve())); }
});
