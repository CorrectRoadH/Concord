import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { Effect } from "effect";
import { parseDocument } from "yaml";

import {
  applyNeutralGovernanceMigration,
  prepareNeutralGovernanceMigration,
  recoverNeutralGovernanceMigration,
} from "../scripts/neutral-governance-migration.js";
import { renderTypeScriptConfig } from "../src/config.js";
import { legacyTracePrivateDirectorySync, tracePrivateDirectorySync } from "../src/coordination.js";
import { digest as contentDigest } from "../src/shared.js";
import { LocalRepository } from "../src/storage.js";

const zeroDigest = `sha256:${"0".repeat(64)}`;
const evidence = {
  red: { path: "proof/red.json", digest: zeroDigest },
  green: { path: "proof/green.json", digest: zeroDigest },
  certificate: { path: "proof/certificate.json", digest: zeroDigest },
  inventory: { path: "proof/inventory.json", digest: zeroDigest },
};

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "concord-neutral-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  write(root, "concord.config.ts", renderTypeScriptConfig({
    format: "concord.project/v1", projectId: "neutral-migration", testRoots: [], sourceRoots: [],
    runner: { kind: "node-test", sourceFiles: [], timeoutMs: 60_000 },
    memorySources: [{ name: "project", provider: "local-files", path: "memory", access: "read-write", defaultWrite: true }],
  }));
  write(root, "concord.repository.json", `${JSON.stringify({ format: "concord.repository/v1", host: "adapter/host.ts" })}\n`);
  write(root, "memory/INDEX.md", "# Memory navigation\n\n[Problem](problem.md)\n");
  write(root, "adapter/host.ts", "export default {};\n");
  mkdirSync(join(root, "acceptance/native"), { recursive: true });
  write(root, "memory/problem.md", `---\nformat: concord.document/v1\nid: problem\ntitle: Problem\ncreatedAt: 2026-09-20T00:00:00.000Z\nkind: memory\nmemoryKind: problem\nstate: open\nepoch: 3\npromotions: []\nhistory: []\n---\n# Problem\n`);
  write(root, "acceptance/native/case.test.ts", "export {};\n");
  write(root, "acceptance/native/case.test.ts.cases.evidence.json", `${JSON.stringify({ format: "niceeval.e2e-case-evidence-index/v1", current: { case_a: { "memory/problem.md": evidence } }, history: [] })}\n`);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=Concord Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  const legacy = legacyTracePrivateDirectorySync(root);
  write(root, ".git/niceeval/docs-trace/generation", "7\n");
  write(root, ".git/niceeval/docs-trace/coordination-id", "123e4567-e89b-12d3-a456-426614174000\n");
  write(root, ".git/niceeval/docs-trace/proof/history.json", `${JSON.stringify({ epoch: 3, invocationIds: ["old-invocation"] })}\n`);
  assert.equal(legacy, join(root, ".git/niceeval/docs-trace"));
  return root;
}

async function plan(root: string) {
  return Effect.runPromise(prepareNeutralGovernanceMigration({
    root,
    suites: [{ id: "native", root: "acceptance/native" }],
    historyPath: "acceptance/history/cases.json",
    generatedAt: "2026-09-20T00:00:00.000Z",
  }));
}

function metadata(source: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source)!;
  return parseDocument(match[1]!, { uniqueKeys: true, merge: false }).toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
}

test("neutral migration preserves private proof bytes and archives legacy current evidence", async (t) => {
  const root = fixture(t);
  const prepared = await plan(root);
  assert.equal(prepared.operatorChecks.restartPreventionExternal, true);
  assert.equal(prepared.legacyState.files.some(file => file.path === "proof/history.json"), true);
  const receipt = await Effect.runPromise(applyNeutralGovernanceMigration(prepared));
  assert.equal(receipt.status, "applied");
  assert.equal((await Effect.runPromise(applyNeutralGovernanceMigration(prepared))).status, "already-applied");

  const config = JSON.parse(readFileSync(join(root, "concord.repository.json"), "utf8")) as Record<string, unknown>;
  assert.equal(config.format, "concord.repository/v2");
  assert.deepEqual(config.suites, [{ id: "native", root: "acceptance/native" }]);
  assert.equal(config.historyPath, "acceptance/history/cases.json");
  assert.equal(config.policy, "concord.native-reliability/v1");
  assert.equal(config.host, "adapter/host.ts");

  const problem = metadata(readFileSync(join(root, "memory/problem.md"), "utf8"));
  assert.equal(problem.epoch, 3);
  assert.deepEqual(problem.history, []);
  assert.equal(problem.evidenceRequirement, "concord.native-reliability/v1");

  const indexPath = join(root, "acceptance/native/case.test.ts.cases.evidence.json");
  const migrated = JSON.parse(readFileSync(indexPath, "utf8")) as { format: string; current: unknown; history: Array<{ evidence: unknown }> };
  assert.equal(migrated.format, "concord.case-evidence-index/v1");
  assert.deepEqual(migrated.current, {});
  assert.deepEqual(migrated.history[0]!.evidence, evidence);
  assert.match(readFileSync(`${indexPath}.legacy.niceeval.e2e-case-evidence-index.v1.json`, "utf8"), /niceeval\.e2e-case-evidence-index\/v1/);

  assert.equal(readFileSync(join(tracePrivateDirectorySync(root), "proof/history.json"), "utf8"), `${JSON.stringify({ epoch: 3, invocationIds: ["old-invocation"] })}\n`);
  assert.equal(existsSync(join(legacyTracePrivateDirectorySync(root), "proof/history.json")), false);
  const repository = new LocalRepository(root, { dryRun: true });
  repository.close();
  assert.equal(existsSync(join(root, ".git/niceeval/docs-trace/coordination-id")), false);
});

test("interrupted neutral migration rolls back exact preimages and preserves its journal on unknown edits", async (t) => {
  const root = fixture(t);
  const prepared = await plan(root);
  await assert.rejects(Effect.runPromise(applyNeutralGovernanceMigration(prepared, { injectFailureAfterMutation: 2 })), /Injected interruption/);
  assert.equal(existsSync(join(root, ".git/concord/neutral-governance-migration-journal.json")), true);
  writeFileSync(join(root, "memory/problem.md"), "unknown edit\n");
  await assert.rejects(Effect.runPromise(recoverNeutralGovernanceMigration(root)), /unknown edit/);
  assert.equal(readFileSync(join(root, "memory/problem.md"), "utf8"), "unknown edit\n");
  assert.equal(existsSync(join(root, ".git/concord/neutral-governance-migration-journal.json")), true);
});

test("apply rejects a forged reviewed output before any write", async (t) => {
  const root = fixture(t);
  const prepared = await plan(root);
  const forged = structuredClone(prepared);
  const problem = forged.repositoryChanges.find(change => change.path === "memory/problem.md")!;
  const after = `${problem.after!}\nforged\n`;
  const changed = forged.repositoryChanges.map(change => change.path === problem.path ? { ...change, after, afterDigest: contentDigest(after) } : change);
  await assert.rejects(Effect.runPromise(applyNeutralGovernanceMigration({ ...forged, repositoryChanges: changed as typeof forged.repositoryChanges })), /does not exactly match/);
  assert.equal(readFileSync(join(root, "memory/problem.md"), "utf8"), problem.before);
  assert.equal(existsSync(join(root, ".git/concord/neutral-governance-migration-journal.json")), false);
});

test("half migration recovery restores legacy state, config, Memory, and evidence index", async (t) => {
  const root = fixture(t);
  const prepared = await plan(root);
  const beforeConfig = readFileSync(join(root, "concord.repository.json"), "utf8");
  const beforeMemory = readFileSync(join(root, "memory/problem.md"), "utf8");
  const beforeIndex = readFileSync(join(root, "acceptance/native/case.test.ts.cases.evidence.json"), "utf8");
  await assert.rejects(Effect.runPromise(applyNeutralGovernanceMigration(prepared, { injectFailureAfterMutation: 6 })), /Injected interruption/);
  const recovered = await Effect.runPromise(recoverNeutralGovernanceMigration(root));
  assert.equal(recovered.status, "rolled-back");
  assert.equal(readFileSync(join(root, "concord.repository.json"), "utf8"), beforeConfig);
  assert.equal(readFileSync(join(root, "memory/problem.md"), "utf8"), beforeMemory);
  assert.equal(readFileSync(join(root, "acceptance/native/case.test.ts.cases.evidence.json"), "utf8"), beforeIndex);
  assert.equal(existsSync(join(root, "acceptance/native/case.test.ts.cases.evidence.json.legacy.niceeval.e2e-case-evidence-index.v1.json")), false);
  assert.equal(readFileSync(join(legacyTracePrivateDirectorySync(root), "generation"), "utf8"), "7\n");
  assert.equal(existsSync(join(tracePrivateDirectorySync(root), "generation")), false);
});

test("planning acquires the legacy lock first and rejects active old writers", async (t) => {
  const root = fixture(t);
  const legacyLock = join(legacyTracePrivateDirectorySync(root), "publication.lock");
  writeFileSync(legacyLock, "");
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { acquireFileLease, releaseFileLease } from './dist/file-lease.js'; import { dirname } from 'node:path'; const lease=acquireFileLease(process.argv[1],dirname(process.argv[2]),'publication.lease','exclusive','test'); console.log('ready'); process.stdin.once('data',()=>releaseFileLease(lease,'test'));", root, legacyLock], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  await new Promise<void>((resolveReady, reject) => {
    child.stdout.once("data", data => data.toString().includes("ready") ? resolveReady() : reject(new Error(`unexpected child output: ${data}`)));
    child.once("error", reject);
  });
  await assert.rejects(plan(root), /busy/);
  assert.equal(existsSync(join(tracePrivateDirectorySync(root), "publication.lock")), false);
  child.stdin.end("done\n");
  await new Promise<void>(resolveExit => child.once("exit", () => resolveExit()));

  writeFileSync(join(legacyTracePrivateDirectorySync(root), "publication-journal.json"), "{}\n");
  await assert.rejects(plan(root), /journal is pending/);
  assert.equal(existsSync(join(root, ".git/concord/neutral-governance-migration-journal.json")), false);
});

test("suite roots must exist while historyPath may be absent", async (t) => {
  const root = fixture(t);
  await assert.rejects(Effect.runPromise(prepareNeutralGovernanceMigration({ root, suites: [{ id: "missing", root: "not-created" }], historyPath: "future/history.json", generatedAt: "2026-09-20T00:00:00.000Z" })), /existing directory/);
  assert.equal(existsSync(join(root, "acceptance/history/cases.json")), false);
  await plan(root);
});

test("coordination-only mode migrates an existing Concord consumer without creating a repository profile", async (t) => {
  const root = fixture(t);
  rmSync(join(root, "concord.repository.json"));
  const beforeMemory = readFileSync(join(root, "memory/problem.md"), "utf8");
  const planDirectory = mkdtempSync(join(tmpdir(), "concord-coordination-plan-"));
  t.after(() => rmSync(planDirectory, { recursive: true, force: true }));
  const planPath = join(planDirectory, "plan.json");
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-neutral-governance.ts", "--root", root, "--coordination-only", "--plan", planPath], { cwd: process.cwd(), encoding: "utf8" });
  const prepared = JSON.parse(readFileSync(planPath, "utf8")) as { mode: string; repositoryChanges: readonly unknown[] };
  assert.equal(prepared.mode, "coordination-only");
  assert.deepEqual(prepared.repositoryChanges, []);
  const applied = execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-neutral-governance.ts", "--apply", "--plan", planPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(applied, /"status":"applied"/);
  assert.equal(existsSync(join(root, "concord.repository.json")), false);
  assert.equal(readFileSync(join(root, "memory/problem.md"), "utf8"), beforeMemory);
  assert.equal(readFileSync(join(tracePrivateDirectorySync(root), "generation"), "utf8"), "7\n");
  assert.equal(existsSync(join(legacyTracePrivateDirectorySync(root), "generation")), false);
});

test("offline migration CLI prepares and applies a reviewed external plan", (t) => {
  const root = fixture(t);
  const planDirectory = mkdtempSync(join(tmpdir(), "concord-neutral-plan-"));
  t.after(() => rmSync(planDirectory, { recursive: true, force: true }));
  const planPath = join(planDirectory, "plan.json");
  const prepared = execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-neutral-governance.ts", "--root", root, "--suite", "native=acceptance/native", "--history-path", "acceptance/history/cases.json", "--plan", planPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(prepared, /"status":"prepared"/);
  const applied = execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-neutral-governance.ts", "--apply", "--plan", planPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(applied, /"status":"applied"/);
});
