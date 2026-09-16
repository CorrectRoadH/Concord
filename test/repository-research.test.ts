import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { runResearchAt } from "../dist/repository/docs/research/domain.js";
import { tracePrivateDirectorySync } from "../dist/coordination.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "concord-research-current-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Concord Test"]);
  execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "init"]);
  return root;
}
const run = (root: string, input: unknown) => Effect.runPromise(runResearchAt(root, input));

test("Research package is title-only by default and supports free-form pages", async t => {
  const root = repo(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const created = await run(root, { command: "create-package", path: "主题/子主题", content: { title: "自由研究" }, dryRun: false });
  assert.equal(created.command, "create-package");
  const readme = readFileSync(join(root, "docs/research/主题/子主题/README.md"), "utf8");
  assert.match(readme, /createdAt:/); assert.match(readme, /# 自由研究/); assert.doesNotMatch(readme, /boundary|nextEvidence|observedOn/);
  await run(root, { command: "add-page", parent: created.ref, page: "材料/中文页.md", content: { title: "材料", body: "任意正文" }, dryRun: false });
  assert.equal(readFileSync(join(root, "docs/research/主题/子主题/材料/中文页.md"), "utf8"), "# 材料\n\n任意正文\n");
  const checked = await run(root, { command: "check", ref: created.ref });
  assert.equal(checked.command, "check");
  assert.equal(checked.ok, true); assert.deepEqual(checked.checkedPaths, ["docs/research/主题/子主题/README.md", "docs/research/主题/子主题/材料/中文页.md"]);
});

test("Research protects existing and nested owners", async t => {
  const root = repo(); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs/research/topic"), { recursive: true }); writeFileSync(join(root, "docs/research/topic/existing.md"), "existing\n");
  await assert.rejects(run(root, { command: "create-package", path: "topic", content: { title: "抢占" }, dryRun: false }), { _tag: "ResearchConflictError" });
  const created = await run(root, { command: "create-package", path: "parent", content: { title: "父" }, dryRun: false });
  mkdirSync(join(root, "docs/research/parent/nested"), { recursive: true }); writeFileSync(join(root, "docs/research/parent/nested/README.md"), "---\nformat: concord.document/v1\nid: nested\ntitle: 子\ncreatedAt: 2026-09-15T00:00:00.000Z\nkind: research\nsources: []\n---\n\n# 子\n");
  await assert.rejects(run(root, { command: "add-page", parent: created.ref, page: "nested/page.md", content: { title: "页" }, dryRun: false }), /Nested Research owner/);
  writeFileSync(join(root, "docs/research/parent/nested/README.md"), "---\nformat: concord.document/v1\nnot: valid\n---\n");
  await assert.rejects(run(root, { command: "add-page", parent: created.ref, page: "nested/other.md", content: { title: "页" }, dryRun: false }), /Nested Research owner metadata is invalid/);
});

test("Research assigns files to the deepest owner and rejects unsafe or malformed ancestors", async t => {
  const root = repo(); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs/research/outer"), { recursive: true });
  writeFileSync(join(root, "docs/research/outer/README.md"), "---\nformat: concord.document/v1\nnot: valid\n---\n");
  await assert.rejects(run(root, { command: "create-package", path: "outer/child", content: { title: "子" }, dryRun: false }), /Ancestor Research owner metadata is invalid/);
  await assert.rejects(run(root, { command: "create-package", path: "bad#topic", content: { title: "坏" }, dryRun: false }), { _tag: "ResearchPathError" });
  const outer = await run(root, { command: "create-package", path: "tree", content: { title: "树" }, dryRun: false });
  mkdirSync(join(root, "docs/research/tree/nested"), { recursive: true });
  writeFileSync(join(root, "docs/research/tree/nested/README.md"), "---\nformat: concord.document/v1\nid: nested\ntitle: 子\ncreatedAt: 2026-09-15T00:00:00.000Z\nkind: research\nsources: []\n---\n\n# 子\n");
  writeFileSync(join(root, "docs/research/tree/nested/child.md"), "# 子材料\n");
  mkdirSync(join(root, "docs/research/tree/plain"), { recursive: true });
  writeFileSync(join(root, "docs/research/tree/plain/README.md"), "普通 README\n");
  const parentCheck = await run(root, { command: "check", ref: outer.ref });
  assert.equal(parentCheck.command, "check");
  assert.equal(parentCheck.ok, true);
  assert.deepEqual(parentCheck.checkedPaths, [
    "docs/research/tree/README.md",
    "docs/research/tree/plain/README.md",
  ]);
  writeFileSync(join(root, "docs/research/tree/legacy.md"), "---\nformat: concord.document/v1\nid: legacy\ntitle: 旧\ncreatedAt: 2026-09-15T00:00:00.000Z\nkind: research\nsources: []\n---\n\n# 旧\n");
  const migrationCheck = await run(root, { command: "check", ref: outer.ref });
  assert.equal(migrationCheck.command, "check");
  assert.equal(migrationCheck.findings.some(finding => finding.code === "research-migration-required"), true);
  symlinkSync(join(root, "docs/research/tree/plain"), join(root, "docs/research/tree/link"));
  await assert.rejects(run(root, { command: "check", ref: outer.ref }), /symbolic links/);
  const nestedCheck = await run(root, { command: "check", ref: "research:docs/research/tree/nested/README.md" });
  assert.equal(nestedCheck.command, "check");
  assert.deepEqual(nestedCheck.checkedPaths, ["docs/research/tree/nested/README.md", "docs/research/tree/nested/child.md"]);
});

test("Research reports migration for old standalone owners and rejects symlinks and recovery journals", async t => {
  const root = repo(); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs/research/old"), { recursive: true });
  writeFileSync(join(root, "docs/research/old/page.md"), "---\nformat: concord.document/v1\nid: old\ntitle: 旧\ncreatedAt: 2026-09-15T00:00:00.000Z\nkind: research\nsources: []\n---\n\n# 旧\n");
  const old = await run(root, { command: "check", ref: "research:docs/research/old/page.md" });
  assert.equal(old.command, "check");
  assert.equal(old.ok, false); assert.equal(old.findings[0]?.code, "research-migration-required");
  symlinkSync(join(root, "docs/research/old"), join(root, "docs/research/linked"));
  await assert.rejects(run(root, { command: "check", ref: "research:docs/research/linked/page.md" }), /symbolic links/);
  const privateDir = tracePrivateDirectorySync(root); writeFileSync(join(privateDir, "multi-file-publication-journal.json"), "{}");
  await assert.rejects(run(root, { command: "check", ref: "research:docs/research/old/page.md" }), { _tag: "TraceRecoveryRequired" });
});
