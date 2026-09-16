import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { Effect } from "effect"
import { NodeFileSystem, NodeRuntime } from "@effect/platform-node"
import { mutateTraceFiles, withTraceReadLease } from "../repository/docs/trace/relation-mutation.js"
import { withMigrationJournalGuard } from "./migration-recovery.js"
import { prepareDocumentPackageMigration, validateDocumentPackageMigrationPlan, verifyDocumentPackagePlan, documentPackagePlanIsApplied } from "./document-package-migration.js"
import { DocumentPackageMigrationPlanSchema } from "./document-package-migration-schema.js"
import { decode, digest } from "../src/shared.js"

const asError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause))
function samePlanShape(a: ReturnType<typeof prepareDocumentPackageMigration>["plan"], b: ReturnType<typeof prepareDocumentPackageMigration>["plan"]): boolean {
  return JSON.stringify({ head: a.head, config: a.config, inputs: a.inputs, classifications: a.classifications, changes: a.changes, outputs: a.outputs, audit: a.audit }) === JSON.stringify({ head: b.head, config: b.config, inputs: b.inputs, classifications: b.classifications, changes: b.changes, outputs: b.outputs, audit: b.audit })
}
const main = Effect.gen(function*() {
  const { values } = parseArgs({ options: { root: { type: "string" }, plan: { type: "string" }, manifest: { type: "string" }, apply: { type: "boolean" } } })
  if (values.plan === undefined) throw new Error("--plan is required")
  const planPath = resolve(values.plan)
  if (values.apply) {
    const plan = yield* Effect.try({ try: () => decode(DocumentPackageMigrationPlanSchema, JSON.parse(readFileSync(planPath, "utf8")) as unknown, planPath), catch: asError })
    if (planPath.startsWith(`${plan.root}/`)) throw new Error("migration plans must be outside the consumer repository")
    validateDocumentPackageMigrationPlan(plan.root, plan)
    const alreadyApplied = yield* withMigrationJournalGuard(plan.root, withTraceReadLease(plan.root, () => Effect.try({
      try: () => documentPackagePlanIsApplied(plan.root, plan), catch: asError
    })))
    if (alreadyApplied) { yield* Effect.log(JSON.stringify({ status: "already-applied" })); return }
    const result = yield* withMigrationJournalGuard(plan.root, mutateTraceFiles({ root: plan.root, operation: "migrate-document-packages", prepareUnderLease: Effect.try({
      try: () => {
        verifyDocumentPackagePlan(plan.root, plan)
        const fresh = prepareDocumentPackageMigration({ root: plan.root, generatedAt: plan.generatedAt })
        if (!samePlanShape(plan, fresh.plan)) throw new Error("the reviewed plan is stale or its write scope was edited")
        return fresh.changes.map(change => ({ path: change.path, bytes: change.after, expectedDigest: change.before === null ? null : digest(change.before) }))
      }, catch: asError
    }) }))
    yield* Effect.log(JSON.stringify({ status: "applied", transaction: result.transactionId }))
    return
  }
  if (values.root === undefined) throw new Error("--root is required for preparation")
  const root = resolve(values.root)
  if (planPath.startsWith(`${root}/`)) throw new Error("migration plans must be outside the consumer repository")
  const result = yield* withMigrationJournalGuard(root, withTraceReadLease(root, () => Effect.try({ try: () => prepareDocumentPackageMigration({ root, generatedAt: new Date().toISOString() }), catch: asError })))
  yield* Effect.try({ try: () => writeFileSync(planPath, `${JSON.stringify(result.plan, null, 2)}\n`, { flag: "wx", mode: 0o600 }), catch: asError })
  const manifestPath = values.manifest
  if (manifestPath !== undefined) yield* Effect.try({ try: () => writeFileSync(resolve(manifestPath), `${JSON.stringify({ format: "concord.document-package-classification/v1", plannerVersion: result.plan.plannerVersion, root: result.plan.root, head: result.plan.head, classifications: result.plan.classifications, ownerMap: result.plan.audit.ownerMap, linkMap: result.plan.audit.linkMap, preservedAssets: result.plan.audit.preservedAssets }, null, 2)}\n`, { flag: "wx", mode: 0o600 }), catch: asError })
  yield* Effect.log(JSON.stringify({ status: "prepared", plan: planPath, changes: result.plan.changes.length, classifications: result.plan.classifications.length, digest: digest(JSON.stringify(result.plan)) }))
})

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) NodeRuntime.runMain(main.pipe(Effect.provide(NodeFileSystem.layer)))
