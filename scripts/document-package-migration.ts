import { execFileSync } from "node:child_process"
import { lstatSync, readFileSync, readdirSync } from "node:fs"
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path"
import { fromMarkdown } from "mdast-util-from-markdown"
import type { Definition, Image, Link, Root, RootContent } from "mdast"
import { parseDocument, stringify } from "yaml"
import { Schema } from "effect"
import { DesignSchema, EngineeringSchema, RoadmapSchema, ResearchSchema, ConcordError, decode, digest } from "../src/shared.js"
import { type DocumentPackageMigrationPlan, type PackageClassification, PackageClassificationSchema, PackageChangeSchema, PackageInputSchema } from "./document-package-migration-schema.js"

const format = "concord.document/v1"
const migrationFormat = "concord.document-package-migration/v1"
const plannerVersion = "document-packages-1"
const ownerRoots = ["docs/engineering", "docs/roadmap", "docs/design", "docs/research"] as const
const historyFragments = [".git/", ".niceeval/", ".concord/", "node_modules/", "dist/", "docs/migrations/"]

const LegacyFrontmatter = Schema.Record(Schema.String, Schema.Unknown)

export interface PackageMigrationOptions { readonly root: string; readonly generatedAt: string }
export interface PackageMigrationResult { readonly plan: DocumentPackageMigrationPlan; readonly changes: readonly StagedChange[] }

function fail(code: string, message: string): never { throw new ConcordError(code, message) }
function safePath(path: string): void {
  if (!path || path.trim() !== path || path.startsWith("/") || /[\\\0\r\n]/u.test(path) || path.split("/").some(part => part === ".." || part === "." || part === "")) fail("MigrationUnsafePath", path)
}
function bytes(root: string, path: string): Buffer | null {
  safePath(path)
  let cursor = root
  for (const part of path.split("/")) {
    cursor = join(cursor, part)
    try { if (lstatSync(cursor).isSymbolicLink()) fail("MigrationUnsafePath", path) }
    catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null; throw cause }
  }
  const stat = lstatSync(join(root, path))
  if (!stat.isFile()) fail("MigrationUnsafePath", `${path}: not a regular file`)
  return readFileSync(join(root, path))
}
function text(root: string, path: string): string | null { const value = bytes(root, path); return value === null ? null : value.toString("utf8") }
function walk(root: string, prefix: string): string[] {
  const result: string[] = []
  const visit = (path: string): void => {
    safePath(path)
    if (path !== "." && historyFragments.some(fragment => path === fragment.slice(0, -1) || path.startsWith(fragment))) return
    const absolute = join(root, path)
    let stat
    try { stat = lstatSync(absolute) } catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return; throw cause }
    if (stat.isSymbolicLink()) fail("MigrationUnsafePath", path)
    if (stat.isFile()) { result.push(path); return }
    if (!stat.isDirectory()) fail("MigrationUnsafePath", path)
    for (const child of readdirSync(absolute).sort()) visit(`${path}/${child}`)
  }
  visit(prefix)
  return result
}
function git(root: string, args: readonly string[]): string { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim() }
function firstRecorded(root: string, path: string, head: string): { commit: string; date: string } {
  const commit = git(root, ["log", "--all", "--diff-filter=A", "--format=%H", "--", path]).split(/\r?\n/u).filter(Boolean).at(-1) ?? head
  const date = git(root, ["show", "-s", "--format=%cI", commit])
  return { commit, date }
}
function split(source: string, path: string): { metadata: unknown | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source)
  if (match === null) return { metadata: null, body: source }
  const parsed = parseDocument(match[1]!, { uniqueKeys: true, merge: false })
  if (parsed.errors.length > 0) fail("MigrationSourceInvalid", `${path}: ${parsed.errors.map(error => error.message).join("; ")}`)
  return { metadata: decode(LegacyFrontmatter, parsed.toJS({ maxAliasCount: 0 }) as unknown, path), body: match[2]! }
}
function yamlOwner(metadata: Record<string, unknown>, body: string): string {
  const heading = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim()
  return typeof metadata.title === "string" ? metadata.title : heading ?? "Untitled document"
}
function sourceRecord(path: string, commit: string, source: string): { path: string; commit: string; digest: string } { return { path, commit, digest: digest(Buffer.from(source)) } }
function explicitDecision(slug: string, sourcePath: string, source: string, head: string): { decision?: Record<string, unknown>; evidence: string[] } {
  const record = sourceRecord(sourcePath, head, source)
  if (slug === "benchmark-web-consumption") return { decision: undefined, evidence: [`${sourcePath}: 明确暂缓选择公开网页接入面`] }
  const selected: Record<string, string> = {
    "agent-install-recipe": "plan-4", "environment-model": "plan-10", "eval-suite-sharing": "plan-3", "experiment-speed": "plan-1", "multi-container-environments": "plan-4", "nested-docker-execution": "plan-5", "observability-package-layout": "source-receipt", "prepare-commands": "plan-1", "projection-api": "plan-1", "relations-api": "plan-1", "record-runtime": "plan-2", "report-authoring": "plan-7", "user-readable-testing": "plan-4"
  }
  const plan = selected[slug]
  if (plan === undefined) fail("MigrationDecisionMissing", `${sourcePath}: no explicit DECISION classification`)
  const evidenceMatch = plan === "source-receipt" ? /Source receipt/iu.test(source) : new RegExp(`(?:采纳|采用|选择)[\\s\\S]{0,100}${plan}`, "iu").test(source)
  if (!evidenceMatch) fail("MigrationDecisionEvidenceMissing", `${sourcePath}: DECISION does not explicitly support ${plan}`)
  return { decision: { selected: plan, reason: `迁移保留 DECISION.md 中的明确裁决：${plan}`, source: record, targets: [] }, evidence: [`${sourcePath}: DECISION 明确裁决 ${plan}`] }
}
function metadataFor(kind: "engineering" | "roadmap" | "design", path: string, source: string, body: string, head: string, first: { commit: string; date: string }): Record<string, unknown> {
  const existing = split(source, path).metadata
  if (existing !== null) {
    if (kind === "engineering") decode(EngineeringSchema, existing, path)
    if (kind === "roadmap") decode(RoadmapSchema, existing, path)
    if (kind === "design") { const design = decode(DesignSchema, existing, path); if (design.decision !== undefined && !design.alternatives.includes(design.decision.selected)) fail("MigrationDecisionAlternativeMismatch", `${path}: selected decision is not declared in alternatives`) }
    return existing as Record<string, unknown>
  }
  const base: Record<string, unknown> = { format, id: path.split("/").at(-2)!, title: yamlOwner({}, body), createdAt: first.date, createdAtSource: { kind: "first-recorded", path, commit: first.commit }, kind }
  if (kind === "roadmap") {
    const cancelled = path.includes("/report-chart-kernel/")
    if (cancelled && !/(?:取消|cancel(?:led|lation)?)/iu.test(body)) fail("MigrationCancellationEvidenceMissing", `${path}: README has no explicit cancellation declaration`)
    return { ...base, state: cancelled ? "cancelled" : "planned", ...(cancelled ? { cancellation: { reason: "README 明确取消该方向", source: sourceRecord(path, head, source) } } : {}) }
  }
  if (kind === "design") return base
  return base
}
function destinationOffset(node: Link | Image | Definition, source: string): { start: number; end: number } | undefined {
  if (node.position === undefined || node.url === null) return undefined
  const segment = source.slice(node.position.start.offset!, node.position.end.offset!)
  const marker = node.type === "definition" ? segment.indexOf(":") : segment.indexOf("(")
  if (marker < 0) return undefined
  let start = marker + 1
  while (/\s/u.test(segment[start] ?? "")) start += 1
  if (segment[start] === "<") {
    const end = segment.indexOf(">", start + 1)
    return end < 0 ? undefined : { start: node.position.start.offset! + start + 1, end: node.position.start.offset! + end }
  }
  const valueStart = start
  let depth = 0
  for (let index = start; index < segment.length; index += 1) {
    const character = segment[index]
    if (character === "\\") { index += 1; continue }
    if (node.type === "definition" && /\s/u.test(character ?? "") && depth === 0) return { start: node.position.start.offset! + valueStart, end: node.position.start.offset! + index }
    if (character === "(") { depth += 1; continue }
    if (character === ")") { if (depth === 0) return { start: node.position.start.offset! + valueStart, end: node.position.start.offset! + index }; depth -= 1 }
  }
  return node.type === "definition" ? { start: node.position.start.offset! + valueStart, end: node.position.end.offset! } : undefined
}
function linkReplacements(sourcePath: string, targetPath: string, files: ReadonlySet<string>, moves: ReadonlyMap<string, string>, body: string, linkMap: { source: string; oldTarget: string; newTarget: string }[]): { body: string; changed: boolean } {
  const tree = fromMarkdown(body)
  const edits: { start: number; end: number; value: string }[] = []
  const mappedPath = (path: string): string => {
    const exact = moves.get(path); if (exact !== undefined) return exact
    const prefix = [...moves.entries()].filter(([old]) => path.startsWith(`${old}/`)).sort(([a], [b]) => b.length - a.length)[0]
    return prefix === undefined ? path : `${prefix[1]}/${path.slice(prefix[0].length + 1)}`
  }
  const visit = (node: Root | RootContent): void => {
    if ((node.type === "link" || node.type === "image" || node.type === "definition") && typeof node.url === "string" && !node.url.startsWith("#") && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(node.url)) {
      const [raw, fragment = ""] = node.url.split("#", 2)
      if (raw !== "") {
        const unescaped = (raw ?? "").replace(/\\([\\()[\]]|`)/gu, "$1")
        const resolved = normalize(join(dirname(sourcePath), decodeURIComponent(unescaped))).split(sep).join("/")
        safePath(resolved.replace(/\/$/u, ""))
        const target = mappedPath(resolved)
        if (sourcePath !== targetPath || target !== resolved) {
          const next = encodeURI(`${relative(dirname(targetPath), target).split(sep).join("/")}${fragment ? `#${fragment}` : ""}`)
          const offset = destinationOffset(node, body)
          if (next !== node.url && offset !== undefined) {
            edits.push({ ...offset, value: next })
            linkMap.push({ source: sourcePath, oldTarget: resolved, newTarget: target })
          }
        }
      }
    }
    if ("children" in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  let result = body
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = `${result.slice(0, edit.start)}${edit.value}${result.slice(edit.end)}`
  return { body: result, changed: result !== body }
}

interface StagedChange { readonly path: string; readonly before: Buffer | null; readonly after: Buffer | null }
function encodedChange(change: StagedChange): { readonly after: string | null; readonly encoding: "utf8" | "base64" } {
  if (change.after === null) return { after: null, encoding: "utf8" }
  try { new TextDecoder("utf-8", { fatal: true }).decode(change.after); return { after: change.after.toString("utf8"), encoding: "utf8" } } catch { return { after: change.after.toString("base64"), encoding: "base64" } }
}
function decodeChange(after: string | null, encoding: "utf8" | "base64"): Buffer | null { return after === null ? null : Buffer.from(after, encoding) }
function rewriteTypedRefs(sourcePath: string, metadata: Record<string, unknown>, moves: ReadonlyMap<string, string>, typedRefs: { source: string; field: string; oldTarget: string; newTarget: string }[]): Record<string, unknown> {
  const output: Record<string, unknown> = { ...metadata }
  const rewrite = (field: string, value: unknown): unknown => {
    if (typeof value !== "string") return value
    const [raw, anchor = ""] = value.split("#", 2)
    if (raw === undefined) return value
    const prefixed = raw.startsWith("research:")
    const target = moves.get(prefixed ? raw.slice("research:".length) : raw)
    if (target === undefined) return value
    const next = `${prefixed ? "research:" : ""}${target}${anchor ? `#${anchor}` : ""}`
    typedRefs.push({ source: sourcePath, field, oldTarget: value, newTarget: next })
    return next
  }
  for (const field of ["feature", "adoptedAs", "origin", "supersededBy"] as const) if (field in output) output[field] = rewrite(field, output[field])
  for (const field of ["sources", "promotions"] as const) if (Array.isArray(output[field])) output[field] = output[field].map(value => rewrite(field, value))
  const decision = output.decision
  if (typeof decision === "object" && decision !== null && !Array.isArray(decision)) {
    const copy: Record<string, unknown> = { ...decision }
    if (Array.isArray(copy.targets)) copy.targets = copy.targets.map(value => rewrite("decision.targets", value))
    output.decision = copy
  }
  const adoptions = output.adoptions
  if (typeof adoptions === "object" && adoptions !== null && !Array.isArray(adoptions)) {
    const copy: Record<string, unknown> = { ...adoptions }
  if (Array.isArray(copy.current)) copy.current = copy.current.map(value => rewrite("adoptions.current", value))
    output.adoptions = copy
  }
  const relations = output.memoryRelations
  if (Array.isArray(relations)) output.memoryRelations = relations.map(value => typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, memory: rewrite("memoryRelations.memory", (value as Record<string, unknown>).memory) } : value)
  return output
}

export function prepareDocumentPackageMigration(options: PackageMigrationOptions): PackageMigrationResult {
  const root = resolve(options.root)
  const head = git(root, ["rev-parse", "HEAD"])
  const configPath = text(root, "concord.config.ts") ?? text(root, "concord.json")
  if (configPath === null) fail("MigrationProjectMissing", root)
  const configName = text(root, "concord.config.ts") !== null ? "concord.config.ts" : "concord.json"
  const allFiles = ownerRoots.flatMap(prefix => walk(root, prefix)).filter(path => !historyFragments.some(fragment => path.includes(fragment))).sort()
  const markdownFiles = allFiles.filter(path => extname(path) === ".md")
  const relatedFiles = ["docs", "memory"].flatMap(prefix => walk(root, prefix)).filter(path => !historyFragments.some(fragment => path.includes(fragment))).sort()
  const repositoryMarkdown = relatedFiles.filter(path => extname(path) === ".md")
  const scannedMarkdown = [...new Set([...markdownFiles, ...repositoryMarkdown])].sort()
  const fileSet = new Set(relatedFiles)
  const changes = new Map<string, StagedChange>()
  const classifications: PackageClassification[] = []
  const ownerMap: { before: string; after: string; sourceDigest: string }[] = []
  const linkMap: { source: string; oldTarget: string; newTarget: string }[] = []
  const typedRefs: { source: string; field: string; oldTarget: string; newTarget: string }[] = []
  const moves = new Map<string, string>()
  const stage = (path: string, after: Buffer | string | null): void => { const before = bytes(root, path); const afterBytes = typeof after === "string" ? Buffer.from(after) : after; if ((before === null ? null : digest(before)) !== (afterBytes === null ? null : digest(afterBytes))) changes.set(path, { path, before, after: afterBytes }) }

  for (const path of markdownFiles) {
    const source = text(root, path)!; const parts = split(source, path); const dir = dirname(path); const leaf = path.split("/").at(-1)!
    if (dir.startsWith("docs/research") && leaf !== "README.md" && parts.metadata !== null) {
      decode(ResearchSchema, parts.metadata, path)
      const target = `${path.slice(0, -3)}/README.md`; const targetDir = path.slice(0, -3); if (allFiles.some(file => file === targetDir || file.startsWith(`${targetDir}/`))) fail("MigrationTargetConflict", `target conflict: existing content under ${targetDir}`)
      moves.set(path, target); classifications.push({ kind: "research-owner", sourcePath: path, targetPath: target, ownerBefore: path, ownerAfter: target, evidence: ["已有 concord.document/v1 Research metadata"] }); ownerMap.push({ before: path, after: target, sourceDigest: digest(bytes(root, path)!) }); stage(path, null); stage(target, Buffer.from(source))
    } else if (dir.startsWith("docs/research") && leaf === "README.md" && parts.metadata !== null) {
      decode(ResearchSchema, parts.metadata, path)
      classifications.push({ kind: "research-owner", sourcePath: path, targetPath: path, ownerBefore: path, ownerAfter: path, evidence: ["已有 README Research identity"] }); ownerMap.push({ before: path, after: path, sourceDigest: digest(source) })
    } else if (dir.startsWith("docs/engineering") && path.split("/").length === 4 && leaf === "README.md" && !dir.endsWith("/_template")) {
      const meta = metadataFor("engineering", path, source, parts.body, head, firstRecorded(root, path, head)); if (parts.metadata === null) stage(path, `---\n${stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n${parts.body}`)
      classifications.push({ kind: "engineering-owner", sourcePath: path, targetPath: path, ownerBefore: path, ownerAfter: path, evidence: ["engineering 二级主题 README"] })
    } else if (dir.startsWith("docs/roadmap") && path.split("/").length === 4 && leaf === "README.md" && !dir.endsWith("/_template")) {
      const meta = metadataFor("roadmap", path, source, parts.body, head, firstRecorded(root, path, head)); if (parts.metadata === null) stage(path, `---\n${stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n${parts.body}`)
      classifications.push({ kind: "roadmap-owner", sourcePath: path, targetPath: path, ownerBefore: path, ownerAfter: path, evidence: [path.includes("report-chart-kernel") ? "DECISION 明确取消" : "Roadmap 主题无 adopted 证据，保持 planned"] })
    } else if (dir.startsWith("docs/design") && path.split("/").length === 4 && leaf === "README.md" && !dir.endsWith("/_template")) {
      const slug = dir.split("/").at(-1)!; const rawPlans = walk(root, dir).filter(file => /\/(?:PLAN-[^/]+|plans\/plan-[^/]+)\/README\.md$/u.test(file)); const alternatives = [...new Set(rawPlans.map(plan => plan.match(/\/(?:PLAN-|plans\/plan-)([^/]+)\/README\.md$/u)?.[1]?.toLowerCase()).filter((value): value is string => value !== undefined).map(value => `plan-${value}`).concat(slug === "observability-package-layout" ? ["source-receipt"] : []))].sort()
      const meta = metadataFor("design", path, source, parts.body, head, firstRecorded(root, path, head)); const hasMetadata = parts.metadata !== null; const hasDecision = hasMetadata && typeof parts.metadata === "object" && parts.metadata !== null && "decision" in parts.metadata; const decision = hasMetadata ? (hasDecision ? { decision: (parts.metadata as Record<string, unknown>).decision as Record<string, unknown>, evidence: [`${path}: 已存在严格 Design decision metadata`] } : { decision: undefined, evidence: [`${path}: 已有 Design metadata，未声称 DECISION 裁决`] }) : explicitDecision(slug, `${dir}/DECISION.md`, text(root, `${dir}/DECISION.md`) ?? "", head)
      const out = { ...meta, ...(hasMetadata ? {} : { alternatives, ...(decision.decision === undefined ? { deferral: { reason: "DECISION.md 明确暂缓，未选择候选", source: sourceRecord(`${dir}/DECISION.md`, head, text(root, `${dir}/DECISION.md`) ?? "") } } : { decision: decision.decision }) }) }; if (!hasMetadata) { if (decision.decision !== undefined && !alternatives.includes(String(decision.decision.selected))) fail("MigrationDecisionAlternativeMismatch", `${path}: selected ${String(decision.decision.selected)} is not in alternatives`); stage(path, `---\n${stringify(out, { lineWidth: 0 }).trimEnd()}\n---\n${parts.body}`) }
      classifications.push({ kind: "design-owner", sourcePath: path, targetPath: path, ownerBefore: path, ownerAfter: path, evidence: decision.evidence })
      if (slug === "observability-package-layout" && !allFiles.some(file => file.startsWith(`${dir}/plans/source-receipt/`))) {
        const decisionPath = `${dir}/DECISION.md`; const decisionSource = text(root, decisionPath) ?? ""; const candidate = `# Source receipt\n\n这是由原 [DECISION](../../DECISION.md) 迁移形成的已选方案；原文摘要：按 Source receipt 的 capture authority 切分 durable layout。原有 PLAN-1/PLAN-2 均在 DECISION 中明确否决，本目录不存在对应旧候选。\n`
        stage(`${dir}/plans/source-receipt/README.md`, candidate); classifications.push({ kind: "design-plan-relocation", sourcePath: decisionPath, targetPath: `${dir}/plans/source-receipt/README.md`, ownerBefore: decisionPath, ownerAfter: `${dir}/plans/source-receipt/README.md`, evidence: ["DECISION 明确选择 source receipt；候选目录由迁移创建"] }); ownerMap.push({ before: decisionPath, after: `${dir}/plans/source-receipt/README.md`, sourceDigest: digest(bytes(root, decisionPath)!) })
      }
      for (const plan of walk(root, dir).filter(file => /\/PLAN-[^/]+\//u.test(file))) { const match = plan.match(/^(.*)\/PLAN-([^/]+)\/(.+)$/u); if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) continue; const planRoot = match[1]; const planName = match[2]; const rest = match[3]; const target = `${planRoot}/plans/plan-${planName.toLowerCase()}/${rest}`; if (allFiles.some(file => file === `${planRoot}/plans/plan-${planName.toLowerCase()}` || file.startsWith(`${planRoot}/plans/plan-${planName.toLowerCase()}/`))) fail("MigrationTargetConflict", `target conflict: ${target}`); moves.set(plan, target); classifications.push({ kind: "design-plan-relocation", sourcePath: plan, targetPath: target, ownerBefore: plan, ownerAfter: target, evidence: ["DECISION alternatives 中的旧 PLAN-N"] }); ownerMap.push({ before: plan, after: target, sourceDigest: digest(bytes(root, plan)!) }); stage(plan, null); stage(target, bytes(root, plan)) }
    }
  }
  const staged = (path: string): Buffer | null => { const change = changes.get(path); return change === undefined ? bytes(root, path) : change.after }
  for (const path of scannedMarkdown) {
    const current = staged(path); if (current === null) continue
    const parts = split(current.toString("utf8"), path)
    if (parts.metadata !== null && typeof parts.metadata === "object" && parts.metadata !== null && !Array.isArray(parts.metadata)) {
      const rewritten = rewriteTypedRefs(path, parts.metadata as Record<string, unknown>, moves, typedRefs)
      if (JSON.stringify(rewritten) !== JSON.stringify(parts.metadata)) stage(path, `---\n${stringify(rewritten, { lineWidth: 0 }).trimEnd()}\n---\n${parts.body}`)
    }
  }
  for (const path of scannedMarkdown) { const targetPath = moves.get(path) ?? path; const current = staged(targetPath); if (current === null) continue; const source = current.toString("utf8"); const parts = split(source, targetPath); const rewritten = linkReplacements(path, targetPath, fileSet, moves, parts.body, linkMap); if (rewritten.changed) stage(targetPath, `${source.slice(0, source.length - parts.body.length)}${rewritten.body}`) }
  const inputFiles = [...new Set([...allFiles, ...scannedMarkdown])].sort()
  const inputPaths: { path: string; digest: string; role: "document" | "configuration" | "history-excluded" }[] = [...inputFiles.map(path => ({ path, digest: digest(bytes(root, path)!), role: "document" as const })), { path: configName, digest: digest(Buffer.from(configPath)), role: "configuration" as const }]
  const planChanges = [...changes.values()].map(change => ({ path: change.path, beforeDigest: change.before === null ? null : digest(change.before), ...encodedChange(change) }))
  const outputMap = new Map(inputPaths.map(input => [input.path, input.digest])); for (const change of [...changes.values()]) { if (change.after === null) outputMap.delete(change.path); else outputMap.set(change.path, digest(change.after)) }
  const plan = decode(Schema.Struct({ format: Schema.Literal(migrationFormat), plannerVersion: Schema.Literal(plannerVersion), root: Schema.String, head: Schema.String, config: Schema.Struct({ path: Schema.String, digest: Schema.String, source: Schema.String }), generatedAt: Schema.String, inputs: Schema.Array(PackageInputSchema), classifications: Schema.Array(PackageClassificationSchema), changes: Schema.Array(PackageChangeSchema), outputs: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })), audit: Schema.Struct({ ownerMap: Schema.Array(Schema.Struct({ before: Schema.String, after: Schema.String, sourceDigest: Schema.String })), linkMap: Schema.Array(Schema.Struct({ source: Schema.String, oldTarget: Schema.String, newTarget: Schema.String })), typedRefs: Schema.Array(Schema.Struct({ source: Schema.String, field: Schema.String, oldTarget: Schema.String, newTarget: Schema.String })), excludedHistory: Schema.Array(Schema.String), preservedAssets: Schema.Array(Schema.String) }) }), { format: migrationFormat, plannerVersion, root, head, config: { path: configName, digest: digest(configPath), source: configPath }, generatedAt: options.generatedAt, inputs: inputPaths, classifications, changes: planChanges, outputs: [...outputMap].sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => ({ path, digest: value })), audit: { ownerMap, linkMap, typedRefs, excludedHistory: ["history frontmatter fields and historical receipts are never rewritten"], preservedAssets: allFiles.filter(path => !path.endsWith(".md")) } }, "document-package migration plan")
  return { plan, changes: [...changes.values()] }
}

export function validateDocumentPackageMigrationPlan(root: string, plan: DocumentPackageMigrationPlan): void {
  if (resolve(root) !== plan.root) fail("MigrationRootMismatch", root)
  if (plan.outputs.length === 0 || plan.changes.length === 0) fail("MigrationPlanInvalid", "plan must contain outputs and changes")
  const groups = [plan.inputs.map(input => input.path), plan.changes.map(change => change.path), plan.outputs.map(output => output.path)]
  const paths = [...new Set(groups.flat()), plan.config.path]
  if (groups.some(group => new Set(group).size !== group.length)) fail("MigrationPlanInvalid", "paths must be unique within each plan collection")
  if (!plan.inputs.some(input => input.path === plan.config.path && input.role === "configuration")) fail("MigrationPlanInvalid", "config snapshot is not bound to the input collection")
  for (const path of paths) safePath(path)
  const expected = new Map(plan.inputs.map(input => [input.path, input.digest]))
  if (digest(plan.config.source) !== plan.config.digest || expected.get(plan.config.path) !== plan.config.digest) fail("MigrationPlanInvalid", "configuration digest mismatch")
  for (const change of plan.changes) {
    if ((expected.get(change.path) ?? null) !== change.beforeDigest) fail("MigrationPlanInvalid", `${change.path}: input and preimage disagree`)
    const after = decodeChange(change.after, change.encoding)
    if (after === null) expected.delete(change.path)
    else expected.set(change.path, digest(after))
  }
  const expectedOutputs = [...expected].sort(([a], [b]) => a.localeCompare(b))
  const declaredOutputs = plan.outputs.map(output => [output.path, output.digest] as const).sort(([a], [b]) => a.localeCompare(b))
  if (JSON.stringify(expectedOutputs) !== JSON.stringify(declaredOutputs)) fail("MigrationPlanInvalid", "outputs do not match complete inputs and changes")
}

export function documentPackagePlanIsApplied(root: string, plan: DocumentPackageMigrationPlan): boolean {
  validateDocumentPackageMigrationPlan(root, plan)
  if (git(root, ["rev-parse", "HEAD"]) !== plan.head) fail("MigrationHeadChanged", "HEAD changed since plan generation")
  const config = text(root, plan.config.path)
  if (config !== plan.config.source) fail("MigrationInputsChanged", "configuration changed since plan generation")
  const actual = [...new Set([...ownerRoots.flatMap(prefix => walk(root, prefix)), ...["docs", "memory"].flatMap(prefix => walk(root, prefix)).filter(path => extname(path) === ".md"), plan.config.path])].sort()
  const expected = plan.outputs.map(output => output.path).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return false
  return plan.outputs.every(output => { const current = bytes(root, output.path); return current !== null && digest(current) === output.digest })

}
export function verifyDocumentPackagePlan(root: string, plan: DocumentPackageMigrationPlan): void {
  validateDocumentPackageMigrationPlan(root, plan)
  if (git(root, ["rev-parse", "HEAD"]) !== plan.head) fail("MigrationHeadChanged", "HEAD changed since plan generation")
  for (const input of plan.inputs) { const current = bytes(root, input.path); if (current === null || digest(current) !== input.digest) fail("MigrationInputsChanged", `${input.path}: input digest changed`) }
  for (const change of plan.changes) { const current = bytes(root, change.path); const currentDigest = current === null ? null : digest(current); if (currentDigest !== change.beforeDigest) fail("MigrationPreimageChanged", change.path) }
}
