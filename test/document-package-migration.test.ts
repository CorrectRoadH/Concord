import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test, { type TestContext } from "node:test"
import { Effect } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { recoverTrace, mutateTraceFiles } from "../repository/docs/trace/relation-mutation.js"
import { traceDigest, tracePrivateDirectory } from "../repository/docs/trace/relation-mutation.js"
import { prepareDocumentPackageMigration, verifyDocumentPackagePlan } from "../scripts/document-package-migration.js"
import { digest } from "../src/shared.js"

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "concord-document-packages-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path: string, value: string | Buffer): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
  write("concord.config.ts", "export default { format: 'concord.project/v1', projectId: 'package-test', testRoots: [], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 } }\n")
  write("docs/engineering/example/README.md", "# Engineering\n\nMechanism.\n")
  write("docs/roadmap/report-chart-kernel/README.md", "# Cancelled\n\nThis direction was explicitly cancelled.\n")
  write("docs/design/agent-install-recipe/README.md", "# Agent recipe\n")
  write("docs/design/agent-install-recipe/DECISION.md", "## 裁决\n\n采纳 PLAN-4。\n")
  write("docs/design/agent-install-recipe/PLAN-4/README.md", "# Plan 4\n\nSee [research](../../../research/topic.md).\n")
  write("docs/research/topic.md", "---\nformat: concord.document/v1\nid: topic\ntitle: Topic\ncreatedAt: 2026-09-01\nkind: research\nsources: []\n---\n# Topic\n\nSee [other](other.md#part), ![中文](space%20name.png).\n\n[x]: other.md#part\n")
  write("docs/research/other.md", "---\nformat: concord.document/v1\nid: other\ntitle: Other\ncreatedAt: 2026-09-01\nkind: research\nsources: []\n---\n# Other\n\n## part\n")
  write("docs/research/space name.png", Buffer.from([1, 2, 3]))
  write("docs/feature/example/README.md", "# Feature\n\nSee [topic](../../research/topic.md).\n")
  execFileSync("git", ["init", "-q", root]); execFileSync("git", ["-C", root, "add", "."]); execFileSync("git", ["-C", root, "-c", "user.name=Concord Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"])
  return root
}

test("document package plan preserves identities, moves research and plans, and rewrites both link directions", (t) => {
  const root = fixture(t)
  const result = prepareDocumentPackageMigration({ root, generatedAt: "2026-09-15T00:00:00.000Z" })
  const paths = new Set(result.plan.changes.map(change => change.path))
  assert(paths.has("docs/research/topic.md")); assert(paths.has("docs/research/topic/README.md"))
  assert(paths.has("docs/design/agent-install-recipe/PLAN-4/README.md")); assert(paths.has("docs/design/agent-install-recipe/plans/plan-4/README.md"))
  assert.equal(result.plan.audit.ownerMap.some(entry => entry.before === "docs/research/topic.md" && entry.after === "docs/research/topic/README.md"), true)
  assert.equal(result.plan.audit.preservedAssets.includes("docs/research/space name.png"), true)
  assert.equal(result.plan.audit.linkMap.some(link => link.source === "docs/design/agent-install-recipe/PLAN-4/README.md"), true)
  assert.equal(result.plan.audit.linkMap.some(link => link.source === "docs/feature/example/README.md" && link.oldTarget === "docs/research/topic.md"), true)
  const movedTopic = result.changes.find(change => change.path === "docs/research/topic/README.md")!.after!.toString("utf8")
  assert.match(movedTopic, /^---\nformat: concord\.document\/v1/m)
  assert.equal(movedTopic.includes("---\n---\n"), false)
  verifyDocumentPackagePlan(root, result.plan)
})

test("plan rejects dirty input and target conflicts before publication", (t) => {
  const root = fixture(t)
  const result = prepareDocumentPackageMigration({ root, generatedAt: "2026-09-15T00:00:00.000Z" })
  writeFileSync(join(root, "docs/research/topic.md"), "unknown edit\n")
  assert.throws(() => verifyDocumentPackagePlan(root, result.plan), /changed|preimage/i)
  const conflictRoot = fixture(t); mkdirSync(join(conflictRoot, "docs/research/topic"), { recursive: true }); writeFileSync(join(conflictRoot, "docs/research/topic/README.md"), "claimed\n")
  assert.throws(() => prepareDocumentPackageMigration({ root: conflictRoot, generatedAt: "2026-09-15T00:00:00.000Z" }), /conflict/i)
})

test("migration publication is idempotent and its interrupted transaction is recoverable", async (t) => {
  const root = fixture(t)
  const result = prepareDocumentPackageMigration({ root, generatedAt: "2026-09-15T00:00:00.000Z" })
  const changes = result.changes.map(change => ({ path: change.path, bytes: change.after, expectedDigest: change.before === null ? null : traceDigest(change.before) }))
  await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: "document-package-test", changes, injectFailureAfterRename: 1 })), /injected interruption/)
  const privateDir = await Effect.runPromise(tracePrivateDirectory(root))
  assert.match(readFileSync(join(privateDir, "multi-file-publication-journal.json"), "utf8"), /document-package-test/)
  await Effect.runPromise(recoverTrace(root))
  assert.equal(readFileSync(join(root, "docs/research/topic.md"), "utf8").includes("kind: research"), true)
  assert.equal(digest(readFileSync(join(root, "docs/research/topic.md"))), result.plan.inputs.find(input => input.path === "docs/research/topic.md")!.digest)
})

// @use-case docs/feature/document-packages/use-case/migrate-document-discovery.md
test("migration CLI repeats verified output and rejects forged output and changed HEAD", t => {
  const root = fixture(t)
  const planDirectory = mkdtempSync(join(tmpdir(), "concord-reviewed-plan-"))
  t.after(() => rmSync(planDirectory, { recursive: true, force: true }))
  const planPath = join(planDirectory, "plan.json")
  const plan = prepareDocumentPackageMigration({ root, generatedAt: "2026-09-15T00:00:00.000Z" }).plan
  writeFileSync(planPath, JSON.stringify(plan))
  const apply = () => execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate-document-packages.ts", "--apply", "--plan", planPath], { encoding: "utf8", stdio: "pipe" })
  assert.match(apply(), /"status":"applied"/)
  assert.match(apply(), /already-applied/)
  const target = join(root, "docs/research/topic/README.md")
  const before = readFileSync(target)
  writeFileSync(planPath, JSON.stringify({ ...plan, outputs: plan.outputs.slice(1) }))
  assert.throws(apply)
  assert.deepEqual(readFileSync(target), before)
  writeFileSync(planPath, JSON.stringify(plan))
  execFileSync("git", ["-C", root, "-c", "user.name=Concord Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "changed HEAD"])
  assert.throws(apply)
  assert.deepEqual(readFileSync(target), before)
})
