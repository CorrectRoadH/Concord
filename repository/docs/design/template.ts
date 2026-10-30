import { randomUUID } from "node:crypto";
import { templateBody } from "concord-sdlc/templates";
import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { Effect, Result, Schema, SchemaIssue } from "effect";
import { stringify } from "yaml";

import { traceDigest, type TraceDirectoryManifestEntry, type TraceMutationPreimage } from "../trace/relation-mutation.js";
import { DesignIoError, DesignManifestInvalid, designErrorMessage } from "./errors.js";
import type {
  DesignDecisionState,
  DesignFileReceipt,
  DesignManifestDigests,
  DesignPlanReceipt,
} from "./model.js";
import { DESIGN_PAGE_ORDER, DocsTemplateManifestSchema, type DesignPage, type DocsTemplateManifest } from "./schema.js";

export const DESIGN_PROJECTION_START = "<!-- concord.design-index/v1:start -->";
export const DESIGN_PROJECTION_END = "<!-- concord.design-index/v1:end -->";
export const DESIGN_DECISION_TEMPLATE = "docs/_template/design-decision";
export const FEATURE_DESIGN_TEMPLATE = "docs/_template/feature-design";
const MANIFEST_FILE = "manifest.json";

interface LoadedTemplate {
  readonly path: string;
  readonly manifest: DocsTemplateManifest;
  readonly manifestDigest: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly preimages: readonly TraceMutationPreimage[];
}

export interface DesignTemplateBundle {
  readonly designDecision: LoadedTemplate;
  readonly featureDesign: LoadedTemplate;
  readonly digests: DesignManifestDigests;
  readonly preimages: readonly TraceMutationPreimage[];
}

export interface GeneratedDesignFile extends DesignFileReceipt {
  readonly relativePath: string;
  readonly source: string;
}

export interface GeneratedDesignPackage {
  readonly slug: string;
  readonly ref: string;
  readonly title: string;
  readonly state: DesignDecisionState;
  readonly cases: boolean;
  readonly pages: readonly DesignPage[];
  readonly plans: readonly DesignPlanReceipt[];
  readonly files: readonly GeneratedDesignFile[];
  readonly manifestDigests: DesignManifestDigests;
  readonly projection: string;
  readonly projectionDigest: string;
}

const slash = (path: string): string => path.split(sep).join("/");
const message = (cause: unknown): string => designErrorMessage(cause);

function templateFailure(path: string, cause: unknown): DesignManifestInvalid {
  return new DesignManifestInvalid({ path, message: message(cause) });
}

/** Repository API creation uses the same bundled templates as concord new. */
function loadTemplate(
  _root: string,
  templatePath: string,
  expectedKinds: readonly ('feature' | 'roadmap' | 'design' | 'design-plan')[],
  expectedOptionalKeys: readonly string[],
): Effect.Effect<LoadedTemplate, DesignManifestInvalid> {
  return Effect.try({
    try: () => {
      const design = expectedKinds.includes('design');
      const requiredFiles = design ? ['README.md', 'GOALS.md', 'LIMITS.md', 'DECISION.md'] : ['README.md'];
      const optionalFiles = Object.fromEntries(expectedOptionalKeys.map(page => [page, [page === 'use-case' ? 'use-case/README.md' : page === 'cases' ? 'CASES.md' : `${page}.md`]]));
      const manifest: DocsTemplateManifest = { format: 'concord.templates/v1', applicableKinds: [...expectedKinds], requiredFiles, optionalFiles };
      const names: Record<string, string> = { 'README.md': design ? 'design' : 'design-plan', 'GOALS.md': 'goals', 'LIMITS.md': 'limits', 'DECISION.md': 'decision-record', 'CASES.md': 'cases', 'use-case/README.md': 'use-case-index', 'cli.md': 'cli', 'library.md': 'library', 'architecture.md': 'architecture' };
      const sources = new Map([...requiredFiles, ...Object.values(optionalFiles).flat()].map(path => [path, templateBody(names[path]!, design ? '<决策主题名>' : '<功能或候选名>')]));
      return { path: templatePath, manifest, sources, manifestDigest: traceDigest(JSON.stringify([...sources])), preimages: [] };
    },
    catch: cause => templateFailure(templatePath, cause),
  });
}

export function loadDesignTemplates(root: string): Effect.Effect<DesignTemplateBundle, DesignManifestInvalid> {
  return Effect.all({
    designDecision: loadTemplate(root, DESIGN_DECISION_TEMPLATE, ["design"], ["cases"]),
    featureDesign: loadTemplate(root, FEATURE_DESIGN_TEMPLATE, ["feature", "roadmap", "design-plan"], DESIGN_PAGE_ORDER),
  }).pipe(Effect.map(({ designDecision, featureDesign }) => ({
    designDecision,
    featureDesign,
    digests: {
      designDecision: designDecision.manifestDigest,
      featureDesign: featureDesign.manifestDigest,
    },
    preimages: [...designDecision.preimages, ...featureDesign.preimages]
      .sort((left, right) => left.path.localeCompare(right.path)),
  })));
}

function source(template: LoadedTemplate, path: string): string {
  const value = template.sources.get(path);
  if (value === undefined) throw new Error(`${template.path}/${path}: source is missing after manifest validation`);
  return value;
}

function nodeFrontmatter(id: string, title: string, alternatives: readonly string[], createdAt: string): string {
  return '';
}

function removeCasesNavigation(value: string): string {
  return value
    .replace(/ · \[CASES\]\(CASES\.md\)/gu, "")
    .replace(/\[CASES\]\(CASES\.md\) · /gu, "");
}

function decisionReadmeScaffold(value: string): string {
  const lines = value.split(/\r?\n/u);
  const navigation = lines.findIndex((line) => line.startsWith("**相关文档**"));
  return navigation < 0 ? value : `${lines[0] ?? ""}\n\n${lines.slice(navigation).join("\n")}`;
}

function planReadmeScaffold(value: string): string {
  const lines = value.split(/\r?\n/u);
  const body = lines.findIndex((line) => line === "## 解决的问题");
  return body < 0 ? value : `${lines[0] ?? ""}\n\n${lines.slice(body).join("\n")}`;
}

function substitute(value: string, placeholder: string, replacement: string): string {
  return value.replaceAll(placeholder, replacement).replaceAll("../../SVG-DESIGN.md", "../../../SVG-DESIGN.md");
}

function pagePaths(template: LoadedTemplate, pages: readonly DesignPage[]): readonly string[] {
  return pages.flatMap((page) => template.manifest.optionalFiles[page] ?? []);
}

export function renderDesignProjection(
  plans: readonly DesignPlanReceipt[],
  state: DesignDecisionState,
): string {
  const selected = state._tag === "decided"
    ? plans.find((plan) => plan.ref === state.selectedPlan)
    : undefined;
  const planLines = plans.map((plan) =>
    `- [${plan.selector}${selected?.ref === plan.ref ? "（已选择）" : ""}](${plan.ref.slice(plan.ref.indexOf("/plans/") + 1)})`
  );
  const decision = selected === undefined
    ? state._tag === "deferred" ? `裁决：已暂缓。${state.reason}` : "裁决：尚未写入 `decision.selected`。"
    : `裁决：[${selected.selector}](${selected.ref.slice(selected.ref.indexOf("/plans/") + 1)})。`;
  return [
    DESIGN_PROJECTION_START,
    "## 候选方案索引（生成）",
    "",
    ...planLines,
    "",
    decision,
    DESIGN_PROJECTION_END,
  ].join("\n");
}

export function replaceDesignProjection(readme: string, projection: string): string | undefined {
  const start = readme.indexOf(DESIGN_PROJECTION_START);
  const end = readme.indexOf(DESIGN_PROJECTION_END);
  if (start < 0 || end < start || readme.indexOf(DESIGN_PROJECTION_START, start + 1) >= 0 ||
    readme.indexOf(DESIGN_PROJECTION_END, end + 1) >= 0) return undefined;
  const after = end + DESIGN_PROJECTION_END.length;
  return `${readme.slice(0, start)}${projection}${readme.slice(after)}`;
}

export function extractDesignProjection(readme: string): string | undefined {
  const start = readme.indexOf(DESIGN_PROJECTION_START);
  const end = readme.indexOf(DESIGN_PROJECTION_END);
  if (start < 0 || end < start || readme.indexOf(DESIGN_PROJECTION_START, start + 1) >= 0 ||
    readme.indexOf(DESIGN_PROJECTION_END, end + 1) >= 0) return undefined;
  return readme.slice(start, end + DESIGN_PROJECTION_END.length);
}

function receiptFile(packageRoot: string, relativePath: string, sourceText: string): GeneratedDesignFile {
  const bytes = Buffer.byteLength(sourceText);
  return {
    relativePath,
    path: `${packageRoot}/${relativePath}`,
    digest: traceDigest(sourceText),
    byteLength: bytes,
    source: sourceText,
  };
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function generateDesignPackage(input: {
  readonly bundle: DesignTemplateBundle;
  readonly slug: string;
  readonly title: string;
  readonly planCount: number;
  readonly cases: boolean;
  readonly pages: readonly DesignPage[];
  readonly createdAt?: string;
}): GeneratedDesignPackage {
  const packageRoot = `docs/design/${input.slug}`;
  const pages = DESIGN_PAGE_ORDER.filter((page) => input.pages.includes(page));
  const plans: DesignPlanReceipt[] = Array.from({ length: input.planCount }, (_, index) => {
    const selector = `plan-${index + 1}`;
    return {
      selector,
      ref: `${packageRoot}/plans/${selector}/README.md`,
      title: `${input.title} · ${selector}`,
      pages,
    };
  });
  const state: DesignDecisionState = { _tag: "undecided" };
  const createdAt = input.createdAt ?? new Date().toISOString();
  const projection = renderDesignProjection(plans, state);
  const files: GeneratedDesignFile[] = [];

  for (const path of input.bundle.designDecision.manifest.requiredFiles) {
    let rendered = substitute(source(input.bundle.designDecision, path), "<决策主题名>", input.title);
    if (path === "README.md") {
      rendered = decisionReadmeScaffold(rendered);
      rendered = `${nodeFrontmatter(input.slug, input.title, plans.map((plan) => plan.selector), createdAt)}${rendered.trimEnd()}\n\n${projection}\n`;
    }
    if (!input.cases) rendered = removeCasesNavigation(rendered);
    files.push(receiptFile(packageRoot, path, rendered));
  }
  if (input.cases) {
    for (const path of input.bundle.designDecision.manifest.optionalFiles.cases ?? []) {
      const rendered = substitute(source(input.bundle.designDecision, path), "<决策主题名>", input.title);
      files.push(receiptFile(packageRoot, path, rendered));
    }
  }

  for (const plan of plans) {
    const selectedPaths = [...input.bundle.featureDesign.manifest.requiredFiles, ...pagePaths(input.bundle.featureDesign, pages)];
    for (const path of selectedPaths) {
      let rendered = substitute(source(input.bundle.featureDesign, path), "<功能或候选名>", plan.title);
      if (path === "README.md") {
        rendered = templateBody('design-plan', plan.title, pages);
        rendered = planReadmeScaffold(rendered);
        rendered = `${rendered.trimEnd()}\n`;
      }
      files.push(receiptFile(packageRoot, `plans/${plan.selector}/${path}`, rendered));
    }
  }

  return {
    slug: input.slug,
    ref: `${packageRoot}/README.md`,
    title: input.title,
    state,
    cases: input.cases,
    pages,
    plans,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    manifestDigests: input.bundle.digests,
    projection,
    projectionDigest: traceDigest(projection),
  };
}

export function generatedDirectoryManifest(
  generated: GeneratedDesignPackage,
): readonly TraceDirectoryManifestEntry[] {
  const directories = new Set<string>(["."]);
  for (const file of generated.files) {
    let cursor = dirname(file.relativePath);
    while (cursor !== ".") {
      directories.add(slash(cursor));
      cursor = dirname(cursor);
    }
  }
  return [
    ...[...directories].map((path): TraceDirectoryManifestEntry => ({ kind: "directory", path, mode: 0o755 })),
    ...generated.files.map((file): TraceDirectoryManifestEntry => ({
      kind: "file",
      path: file.relativePath,
      mode: 0o644,
      byteLength: file.byteLength,
      digest: file.digest,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export function stageGeneratedDesign(
  root: string,
  generated: GeneratedDesignPackage,
): Effect.Effect<{ readonly stagePath: string; readonly targetPath: string }, DesignIoError> {
  const parent = resolve(root, "docs/design");
  const stageName = `.stage-${randomUUID()}`;
  const stage = resolve(parent, stageName);
  return Effect.try({
    try: () => {
      mkdirSync(stage, { mode: 0o755 });
      chmodSync(stage, 0o755);
      const directories = new Set<string>([stage]);
      for (const file of generated.files) {
        const target = resolve(stage, file.relativePath);
        mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
        chmodSync(dirname(target), 0o755);
        directories.add(dirname(target));
        const descriptor = openSync(target, "wx", 0o644);
        try {
          fchmodSync(descriptor, 0o644);
          writeFileSync(descriptor, file.source, "utf8");
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      }
      for (const directory of [...directories].sort((left, right) => right.length - left.length)) fsyncDirectory(directory);
      fsyncDirectory(parent);
      return {
        stagePath: `docs/design/${stageName}`,
        targetPath: `docs/design/${generated.slug}`,
      };
    },
    catch: (cause) => {
      rmSync(stage, { recursive: true, force: true });
      return new DesignIoError({ operation: "stage design", path: slash(relative(root, stage)), message: message(cause) });
    },
  });
}

export function removeDesignStage(root: string, stagePath: string): Effect.Effect<void, DesignIoError> {
  return Effect.try({
    try: () => rmSync(resolve(root, stagePath), { recursive: true, force: true }),
    catch: (cause) => new DesignIoError({ operation: "remove design stage", path: stagePath, message: message(cause) }),
  });
}
