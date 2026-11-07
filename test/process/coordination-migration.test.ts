// 跨进程保证：OS 锁与互斥——真实generic或Trace写进程持有publication所有权时独立来源读仍可完成。
import { withPublication } from '../support/repository.ts';
import { installedConcordCli } from '../support/support.ts';
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from '../support/temporary.ts';
import { join } from "node:path";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Effect } from "effect";
import { renderTypeScriptConfig } from "../../src/base/workspace/index.ts";
import { LocalRepository } from "../support/repository.ts";
import { acquireTraceLeaseSync, genericJournalPath, genericPrivateDirectorySync, releaseTraceLeaseSync, tracePrivateDirectorySync } from "../../src/base/publication/index.ts";
import { mutateTraceFiles, recoverTrace, traceDigest, withTraceLease } from "../../src/base/publication/index.ts";
import { TraceRecoveryConflict, TraceRecoveryRequired } from "../../src/model/index.ts";

function isolatedRepository(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "concord-coordination-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "concord.config.ts"), renderTypeScriptConfig({ testRoots: ["test"], runner: { kind: "node-test", sourceFiles: [], timeoutMs: 60000 } }));
  execFileSync("git", ["-C", root, "add", "concord.config.ts"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Concord Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  return root;
}

function publicationChild(root: string, program: string) {
  const child = spawn(process.execPath, ["--eval", program, root], { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", diagnostic = "", finished = false;
  child.stderr.on("data", data => { diagnostic += data.toString(); });
  const closed = new Promise<void>(resolve => child.once("close", () => { finished = true; resolve(); }));
  const ready = new Promise<void>((resolve, reject) => {
    const onData = (data: Buffer) => {
      output += data.toString();
      if (output.includes("ready\n")) { cleanup(); resolve(); }
    };
    const onError = (cause: Error) => { cleanup(); reject(cause); };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup(); reject(new Error(`Publication child exited before ready: code=${code}; signal=${signal}; stdout=${output}; stderr=${diagnostic}`));
    };
    const cleanup = () => { child.stdout.off("data", onData); child.off("error", onError); child.off("close", onClose); };
    child.stdout.on("data", onData); child.once("error", onError); child.once("close", onClose);
  });
  return { ready, async close() { if (!finished) child.stdin.end("done"); await closed; } };
}

test("generic and Trace operations share one portable publication lease", async (t) => {
  const root = isolatedRepository(t);
  const lease = acquireTraceLeaseSync(root, "exclusive", "test-hold", true, undefined, process.env);
  (await LocalRepository.open(root, { dryRun: true })).close();
  assert.throws(() => acquireTraceLeaseSync(root, "shared", "test-shared", true, undefined, process.env), /busy|lease/i);
  releaseTraceLeaseSync(lease!, "test-release");
  const repository = (await LocalRepository.open(root, { dryRun: true }));
  repository.close();
});

test("the shared lease also excludes a separate Bun process", async (t) => {
  const root = isolatedRepository(t);
  const child = publicationChild(root, `import { acquireTraceLeaseSync, releaseTraceLeaseSync } from './src/base/publication/index.ts'; const lease = acquireTraceLeaseSync(process.argv[1], 'exclusive', 'child-hold', true, undefined, process.env); console.log('ready'); process.stdin.once('data', () => { if (lease) releaseTraceLeaseSync(lease, 'child-release'); });`);
  try {
    await child.ready;
    (await LocalRepository.open(root, { dryRun: true })).close();
  } finally {
    await child.close();
  }
});

test("multi-file deletion journals and recovers an interrupted Unicode path without resolving an ID", async (t) => {
  const root = isolatedRepository(t);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "taste.md"), "# Project taste\n");
  writeFileSync(join(root, "中文文档.md"), "before\n");
  const before = traceDigest("before\n");
  await assert.rejects(
    Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "delete-fixture", changes: [{ path: "中文文档.md", bytes: null, expectedDigest: before }], injectFailureAfterRename: 1 }))),
    /injected interruption/,
  );
  assert.equal(readFileSync(join(tracePrivateDirectorySync(root, process.env), "multi-file-publication-journal.json"), "utf8").includes('"kind":"absent"'), true);
  const recovered = JSON.parse(execFileSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'recover'], { encoding: 'utf8' })) as { status: string; receipt: { recovered: boolean } };
  assert.equal(recovered.status, 'trace-recovered');
  const receipt = recovered.receipt;
  assert.equal(receipt.recovered, true);
  assert.equal(readFileSync(join(root, "中文文档.md"), "utf8"), "before\n");
  assert.equal((await Effect.runPromise(withPublication(recoverTrace(root)))).recovered, false);
  const repository = (await LocalRepository.open(root, { dryRun: true }));
  assert.equal(repository.root, root);
  repository.close();
});

test("committed recovery verifies the planned deletion and is repeatable", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "docs.md"), "before\n");
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "delete-after-commit", changes: [{ path: "docs.md", bytes: null, expectedDigest: traceDigest("before\n") }], injectFailureAfterCommit: true }))), /injected interruption/);
  assert.throws(() => readFileSync(join(root, "docs.md"), "utf8"), /ENOENT/);
  assert.equal((await Effect.runPromise(withPublication(recoverTrace(root)))).recovered, true);
  assert.throws(() => readFileSync(join(root, "docs.md"), "utf8"), /ENOENT/);
  assert.equal((await Effect.runPromise(withPublication(recoverTrace(root)))).recovered, false);
});

test("unknown edits preserve the interrupted transaction for conflict inspection", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "docs.md"), "before\n");
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "delete-conflict", changes: [{ path: "docs.md", bytes: null, expectedDigest: traceDigest("before\n") }], injectFailureAfterRename: 1 }))), /injected interruption/);
  writeFileSync(join(root, "docs.md"), "unknown edit\n");
  await assert.rejects((Effect.runPromise(withPublication(recoverTrace(root)))), /neither its recorded preimage nor planned image/);
  assert.equal(readFileSync(join(root, "docs.md"), "utf8"), "unknown edit\n");
});

test("old multi-file journal format is rejected by strict recovery", async (t) => {
  const root = isolatedRepository(t);
  const directory = tracePrivateDirectorySync(root, process.env);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "multi-file-publication-journal.json"), JSON.stringify({ format: "niceeval.docs-trace/multi-file-publication-journal/v1", files: [] }));
  await assert.rejects((Effect.runPromise(withPublication(recoverTrace(root)))), (cause) => cause instanceof TraceRecoveryConflict);
});

test("a mixed write/delete transaction validates every temp before rolling back any target", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "delete.md"), "before\n");
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "mixed-conflict", changes: [
    { path: "write.md", bytes: "planned\n" },
    { path: "delete.md", bytes: null, expectedDigest: traceDigest("before\n") },
  ], injectFailureAfterRename: 1 }))), /injected interruption/);
  const journalPath = join(tracePrivateDirectorySync(root, process.env), "multi-file-publication-journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { files: readonly { path: string; temporary: string }[] };
  const deleteEntry = journal.files.find((file) => file.path === "delete.md")!;
  writeFileSync(join(root, deleteEntry.temporary), "tampered temporary\n");
  await assert.rejects((Effect.runPromise(withPublication(recoverTrace(root)))), /temporary exists for an absent planned image|temporary is neither absent nor its planned image/);
  assert.equal(readFileSync(join(root, "write.md"), "utf8"), "planned\n");
  assert.equal(readFileSync(join(root, "delete.md"), "utf8"), "before\n");
});

test("v2 journal path, temporary, digest, and phase tampering is rejected before recovery", async (t) => {
  const root = isolatedRepository(t);
  writeFileSync(join(root, "journal.md"), "before\n");
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "journal-tamper", changes: [{ path: "journal.md", bytes: "after\n" }], injectFailureAfterRename: 1 }))), /injected interruption/);
  const journalPath = join(tracePrivateDirectorySync(root, process.env), "multi-file-publication-journal.json");
  const original = JSON.parse(readFileSync(journalPath, "utf8")) as { phase: string; files: Array<{ path: string; temporary: string; preimage: { kind: string; digest?: string } }> };
  const variants = [
    (value: typeof original) => { value.files[0]!.temporary = "journal.md.wrong.tmp"; },
    (value: typeof original) => { value.files[0]!.path = "../outside.md"; },
    (value: typeof original) => { value.files[0]!.preimage.digest = "sha256:" + "0".repeat(64); },
    (value: typeof original) => { (value.files[0]!.preimage as { kind: string; bytesBase64?: string }).bytesBase64 = "AAAA garbage"; },
    (value: typeof original) => { value.phase = "unknown"; },
  ];
  for (const mutate of variants) {
    const candidate = structuredClone(original);
    mutate(candidate);
    writeFileSync(journalPath, JSON.stringify(candidate));
    await assert.rejects((Effect.runPromise(withPublication(recoverTrace(root)))), /temporary path|unsafe|index entries and files differ|preimage does not match|phase/);
    writeFileSync(journalPath, JSON.stringify(original));
  }
  assert.equal(readFileSync(join(root, "journal.md"), "utf8"), "after\n");
});

test("generic and both Trace journals block ordinary reads/writes and cross-recovery", async (t) => {
  const root = isolatedRepository(t);
  const traceDirectory = tracePrivateDirectorySync(root, process.env);
  mkdirSync(traceDirectory, { recursive: true });
  const traceJournal = join(traceDirectory, "publication-journal.json");
  const genericJournal = genericJournalPath(root, process.env);
  mkdirSync(genericPrivateDirectorySync(root, process.env), { recursive: true });
  writeFileSync(traceJournal, "{}\n");
  (await assert.rejects(async () => (await LocalRepository.open(root, { dryRun: true })), /Trace publication/));
  await assert.rejects(async () => { const reader = (await LocalRepository.open(root, { access: 'read' })); reader.close(); }, (cause) => cause instanceof Error && ('code' in cause && cause.code === 'RecoveryRequired' || cause instanceof TraceRecoveryRequired));
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "blocked-by-trace", changes: [{ path: "blocked.md", bytes: "nope" }] }))), (cause) => cause instanceof Error && ('code' in cause && cause.code === 'RecoveryRequired' || cause instanceof TraceRecoveryRequired));
  writeFileSync(genericJournal, JSON.stringify({ format: "concord.journal", root, privateDir: genericPrivateDirectorySync(root, process.env), operation: "pending", phase: "prepared", directories: [], changes: [], scope: { kind: "documents", configPath: "concord.config.ts", configSource: "", configDigest: "sha256:pending" } }));
  await assert.rejects((Effect.runPromise(withPublication(recoverTrace(root)))), (cause) => cause instanceof Error && ('code' in cause && cause.code === 'RecoveryRequired' || cause instanceof TraceRecoveryRequired && cause.nextStep === 'concord recover'));
  (await assert.rejects(async () => (await LocalRepository.open(root, { recover: true })), /Trace publication/));
  rmSync(traceJournal);
  await assert.rejects(async () => { const reader = (await LocalRepository.open(root, { access: 'read' })); reader.close(); }, (cause) => cause instanceof Error && ('code' in cause && cause.code === 'RecoveryRequired' || cause instanceof TraceRecoveryRequired && cause.nextStep === 'concord recover'));
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "blocked-by-generic", changes: [{ path: "blocked.md", bytes: "nope" }] }))), (cause) => cause instanceof Error && ('code' in cause && cause.code === 'RecoveryRequired' || cause instanceof TraceRecoveryRequired && cause.nextStep === 'concord recover'));
});

test("private coordination paths reject symlinked Trace and generic directories", async (t) => {
  const traceRoot = isolatedRepository(t);
  mkdirSync(join(traceRoot, ".git", "concord"), { recursive: true });
  symlinkSync(traceRoot, join(traceRoot, ".git", "concord", "trace"));
  assert.throws(() => acquireTraceLeaseSync(traceRoot, "shared", "symlink-trace", true, undefined, process.env), /symbolic links/);
  const genericRoot = isolatedRepository(t);
  mkdirSync(join(genericRoot, ".git"), { recursive: true });
  symlinkSync(genericRoot, join(genericRoot, ".git", "concord"));
  (await assert.rejects(async () => (await LocalRepository.open(genericRoot, { dryRun: true })), /symbolic links/));
  const journalRoot = isolatedRepository(t);
  mkdirSync(join(journalRoot, ".git", "concord"), { recursive: true });
  symlinkSync(journalRoot, join(journalRoot, ".git", "concord", "journal.json"));
  (await assert.rejects(async () => (await LocalRepository.open(journalRoot, { dryRun: true })), { code: 'UnsafePath' }));
});

test("fresh repositories create only Concord private coordination state", async (t) => {
  const root = isolatedRepository(t);
  const repository = (await LocalRepository.open(root, { dryRun: true }));
  repository.close();
  assert.equal(existsSync(join(root, ".git", "niceeval")), false);
  assert.equal(tracePrivateDirectorySync(root, process.env), join(root, ".git", "concord", "trace"));
});

test("ordinary runtime ignores unrelated private directories", async (t) => {
  const root = isolatedRepository(t);
  const legacy = join(root, ".git", "niceeval", "docs-trace");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "generation"), "4\n");
  (await LocalRepository.open(root, { dryRun: true })).close();
  assert.equal(readFileSync(join(legacy, "generation"), "utf8"), "4\n");

});

test("governance configuration participates as a same-preimage guard without becoming a writable owner", async (t) => {
  const root = isolatedRepository(t);
  mkdirSync(join(root, "docs", "feature", "guard"), { recursive: true });
  writeFileSync(join(root, "docs", "feature", "guard", "README.md"), "before\n");
  writeFileSync(join(root, "docs", "feature", "guard", "architecture.md"), "supporting guard\n");
  const repository = (await LocalRepository.open(root));
  try {
    const receipt = (await repository.publish("guarded-write", [
      { path: "docs/feature/guard/README.md", before: "before\n", after: "after\n" },
      { path: "docs/feature/guard/architecture.md", before: "supporting guard\n", after: "supporting guard\n" },
    ]));
    assert.deepEqual(receipt.changedPaths, ["docs/feature/guard/README.md", "docs/feature/guard/architecture.md"]);
    assert.equal(readFileSync(join(root, "docs", "feature", "guard", "README.md"), "utf8"), "after\n");
    assert.equal(readFileSync(join(root, "docs", "feature", "guard", "architecture.md"), "utf8"), "supporting guard\n");
    assert.equal(existsSync(join(root, "concord.repository.json")), false);
    (await assert.rejects(async () => (await repository.publish("forbidden-governance-write", [{ path: "concord.repository.json", before: null, after: "{}\n" }])), /Governance configuration|Not a Concord document owner/));
  } finally { repository.close(); }
});

test("invalid generated mode or oversized bytes are rejected before a journal is durable", async (t) => {
  const root = isolatedRepository(t);
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "invalid-mode", changes: [{ path: "bad.md", bytes: "x", mode: 0x10000 }] }))), /invalid mode/);
  await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: "oversized", changes: [{ path: "bad.md", bytes: Buffer.alloc(32 * 1024 * 1024 + 1) }] }))), /planned file exceeds|owner exceeds/);
  assert.throws(() => readFileSync(join(tracePrivateDirectorySync(root, process.env), "multi-file-publication-journal.json"), "utf8"), /ENOENT/);
});

test("source reads remain available while generic and Trace writers hold ownership", async (t) => {
  const root = isolatedRepository(t);
  const genericChild = publicationChild(root, `import { LocalRepository } from './test/support/repository.ts'; const repository = await LocalRepository.open(process.argv[1]); repository.beginSnapshot(); console.log('ready'); process.stdin.once('data', () => repository.close());`);
  try {
    await genericChild.ready;
    assert.equal(await Effect.runPromise(Effect.tryPromise(async () => { const reader = (await LocalRepository.open(root, { access: 'read' })); reader.close(); return true; })), true);
  } finally { await genericChild.close(); }

  const profileChild = publicationChild(root, `import { runApplication } from './test/support/repository.ts'; import { Effect } from 'effect'; import { mutateTraceFiles } from './src/base/publication/index.ts'; await runApplication(mutateTraceFiles({ root: process.argv[1], operation: 'hold-profile', prepareUnderLease: Effect.promise(() => { console.log('ready'); return new Promise((resolve) => process.stdin.once('data', () => resolve([{ path: 'held.md', bytes: 'held\\n' }]))); }) }));`);
  try {
    await profileChild.ready;
    (await LocalRepository.open(root, { dryRun: true })).close();
  } finally { await profileChild.close(); }
});
