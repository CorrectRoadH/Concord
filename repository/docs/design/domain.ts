import { repositoryRoot } from "../../root.js";
import { isDocumentName } from 'concord-sdlc/document-layout';
import { designContentPaths, validateDesignContent, type DesignContentResult } from "concord-sdlc/design-content";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as FileSystem from "effect/FileSystem";
import { Cause, Effect, Exit, Option, Result } from "effect";

import { compileTraceUnderLease } from "../trace/compiler.js";
import type { TraceError } from "../trace/errors.js";
import type { TraceNode, TraceSnapshot } from "../trace/model.js";
import { validateRepoRefTarget, type ValidatedRepoRefTarget } from "../trace/ref.js";
import {
  mutateTraceOwner,
  traceDigest,
  TraceMutationError,
  type TraceCoordinationError,
  type TraceDirectoryManifestEntry,
  type TraceMutationPreparation,
  withTraceReadLease,
} from "../trace/relation-mutation.js";
import { decodeDesignReadme, encodeDecidedDesignReadme } from "./codec.js";
import {
  DesignAlreadyDecided,
  DesignConflict,
  DesignDecisionIncomplete,
  type DesignDomainError,
  DesignInputInvalid,
  DesignIoError,
  DesignSelectorAmbiguous,
  DesignSelectorMissing,
  designErrorMessage,
} from "./errors.js";
import type {
  DesignCheckFinding,
  DesignCheckReceipt,
  DesignCreateReceipt,
  DesignDecisionState,
  DesignDecideReceipt,
  DesignFileReceipt,
  DesignPlanReceipt,
  DesignReceipt,
} from "./model.js";
import {
  extractDesignProjection,
  generateDesignPackage,
  generatedDirectoryManifest,
  loadDesignTemplates,
  removeDesignStage,
  renderDesignProjection,
  replaceDesignProjection,
  stageGeneratedDesign,
  type DesignTemplateBundle,
  type GeneratedDesignPackage,
} from "./template.js";
import { DESIGN_PAGE_ORDER, decodeDesignCommandInput, type DesignCommandInput, type DesignPage } from "./schema.js";

export type DesignCommandError = DesignDomainError | TraceError | TraceCoordinationError;

export interface DesignCreateOptions {
  readonly slug: string;
  readonly title: string;
  readonly plans: number;
  readonly cases: boolean;
  readonly pages: readonly DesignPage[];
  readonly dryRun: boolean;
}

const slash = (path: string): string => path.split(sep).join("/");
const fileReceipt = (path: string, source: string): DesignFileReceipt => ({
  path,
  digest: traceDigest(source),
  byteLength: Buffer.byteLength(source),
});
const designSlug = (path: string): string => path.slice("docs/design/".length, -"/README.md".length);
const displayDesignTitle = (title: string): string => title.replace(/\s+——\s+Design Decision$/u, "");
const displayPlanTitle = (title: string): string => title.replace(/\s+——\s+Feature Design Package$/u, "");

function readText(root: string, path: string): Effect.Effect<string, DesignIoError> {
  return Effect.try({
    try: () => readFileSync(resolve(root, path), "utf8"),
    catch: (cause) => new DesignIoError({ operation: "read", path, message: designErrorMessage(cause) }),
  });
}

function selectDesign(snapshot: TraceSnapshot, selector: string): Effect.Effect<TraceNode, DesignSelectorMissing | DesignSelectorAmbiguous> {
  const matches = snapshot.nodes.filter((node) => node.kind === "design" &&
    (node.path === selector || node.id === selector));
  if (matches.length === 0) {
    return Effect.fail(new DesignSelectorMissing({
      selector,
      subject: "design",
      nextStep: "Use an exact Design slug or docs/design/<slug>/README.md from pnpm run repo docs design check.",
    }));
  }
  if (matches.length > 1) {
    return Effect.fail(new DesignSelectorAmbiguous({
      selector,
      subject: "design",
      candidates: matches.map((node) => node.path).sort(),
    }));
  }
  const match = matches[0];
  return match === undefined
    ? Effect.fail(new DesignSelectorMissing({ selector, subject: "design", nextStep: "Retry with an exact Design ref." }))
    : Effect.succeed(match);
}

function directPlans(snapshot: TraceSnapshot, design: TraceNode): readonly TraceNode[] {
  const root = dirname(design.path);
  return snapshot.nodes.filter((node) => node.kind === "design-plan" &&
    dirname(dirname(dirname(node.path))) === root).sort((left, right) => planNumber(left.path) - planNumber(right.path));
}

function planSelector(path: string): string {
  return basename(dirname(path));
}

function planNumber(path: string): number {
  return Number.parseInt(planSelector(path).slice("plan-".length), 10);
}

function selectPlan(
  snapshot: TraceSnapshot,
  design: TraceNode,
  selector: string,
): Effect.Effect<TraceNode, DesignSelectorMissing | DesignSelectorAmbiguous> {
  const matches = directPlans(snapshot, design).filter((plan) =>
    plan.path === selector || planSelector(plan.path) === selector
  );
  if (matches.length === 0) {
    return Effect.fail(new DesignSelectorMissing({
      selector,
      subject: "plan",
      nextStep: `Choose an exact declared alternative or direct child ref under ${dirname(design.path)}/plans.`,
    }));
  }
  if (matches.length > 1) {
    return Effect.fail(new DesignSelectorAmbiguous({
      selector,
      subject: "plan",
      candidates: matches.map((plan) => plan.path).sort(),
    }));
  }
  const match = matches[0];
  return match === undefined
    ? Effect.fail(new DesignSelectorMissing({ selector, subject: "plan", nextStep: "Retry with an exact direct Plan ref." }))
    : Effect.succeed(match);
}

function stateOf(root: string, design: TraceNode): Effect.Effect<DesignDecisionState, DesignIoError> {
  return Effect.try({
    try: () => decodeDesignReadme(design.path, readFileSync(resolve(root, design.path), "utf8")).state,
    catch: cause => new DesignIoError({ operation: "read Design state", path: design.path, message: designErrorMessage(cause) }),
  });
}

function pagesForPlan(root: string, plan: TraceNode, bundle: DesignTemplateBundle): readonly DesignPage[] {
  const packageRoot = dirname(plan.path);
  return DESIGN_PAGE_ORDER.filter((page) => (bundle.featureDesign.manifest.optionalFiles[page] ?? [])
    .every((path) => existsSync(resolve(root, packageRoot, path))));
}

function planReceipts(root: string, plans: readonly TraceNode[], bundle: DesignTemplateBundle): readonly DesignPlanReceipt[] {
  return plans.map((plan) => ({
    selector: planSelector(plan.path),
    ref: plan.path,
    title: displayPlanTitle(plan.title),
    pages: pagesForPlan(root, plan, bundle),
  }));
}

function generatedSummary(generated: GeneratedDesignPackage) {
  return {
    slug: generated.slug,
    ref: generated.ref,
    title: generated.title,
    state: generated.state,
    cases: generated.cases,
    plans: generated.plans,
    manifestDigests: generated.manifestDigests,
    files: generated.files.map(({ path, digest, byteLength }) => ({ path, digest, byteLength })),
    projectionDigest: generated.projectionDigest,
  };
}

function sameManifest(
  left: readonly TraceDirectoryManifestEntry[],
  right: readonly TraceDirectoryManifestEntry[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeCreate(input: Extract<DesignCommandInput, { readonly command: "create" }>): DesignCreateOptions {
  return {
    slug: input.slug,
    title: input.title,
    plans: input.plans ?? 2,
    cases: input.cases ?? false,
    pages: DESIGN_PAGE_ORDER.filter((page) => (input.pages ?? []).includes(page)),
    dryRun: input.dryRun ?? false,
  };
}

function prepareCreate(root: string, input: DesignCreateOptions): Effect.Effect<TraceMutationPreparation, DesignCommandError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const snapshot = yield* compileTraceUnderLease(root);
    const bundle = yield* loadDesignTemplates(root);
    const target = `docs/design/${input.slug}`;
    if (snapshot.nodes.some((node) => node.path === `${target}/README.md` || node.kind === 'design' && node.id === input.slug) || existsSync(resolve(root, target))) {
      return yield* new DesignConflict({ operation: "create", path: target, message: "Design package already exists" });
    }
    return {
      generation: snapshot.generation,
      snapshotDigest: snapshot.digest,
      preimages: bundle.preimages,
    };
  });
}

function preserveStage<E>(exit: Exit.Exit<unknown, E>): boolean {
  if (Exit.isSuccess(exit)) return false;
  const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
  return failure instanceof TraceMutationError &&
    (failure.operation === "recover-after-failure" || failure.phase === "rollback");
}

function resumeExit<A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> {
  return Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.succeed(exit.value);
}

function withGeneratedStage<A, E, R>(
  root: string,
  generated: GeneratedDesignPackage,
  use: (stage: { readonly stagePath: string; readonly targetPath: string }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DesignIoError, R> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function*() {
    const stage = yield* stageGeneratedDesign(root, generated);
    const useExit = yield* Effect.exit(restore(use(stage)));
    if (preserveStage(useExit)) return yield* resumeExit(useExit);
    const cleanupExit = yield* Effect.exit(removeDesignStage(root, stage.stagePath));
    if (Exit.isFailure(cleanupExit)) {
      if (Exit.isFailure(useExit)) return yield* Effect.failCause(Cause.combine(useExit.cause, cleanupExit.cause));
      return yield* Effect.failCause(cleanupExit.cause);
    }
    return yield* resumeExit(useExit);
  }));
}

export function createDesignAt(
  root: string,
  input: DesignCreateOptions,
): Effect.Effect<DesignCreateReceipt, DesignCommandError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const initialBundle = yield* loadDesignTemplates(root);
    const createdAt = new Date().toISOString();
    const initial = generateDesignPackage({
      bundle: initialBundle,
      createdAt,
      slug: input.slug,
      title: input.title,
      planCount: input.plans,
      cases: input.cases,
      pages: input.pages,
    });
    const expectedManifest = generatedDirectoryManifest(initial);
    const execute = (publication?: { readonly stagePath: string; readonly targetPath: string }) => mutateTraceOwner({
      root,
      operation: "design-create",
      ownerPath: initial.ref,
      dryRun: input.dryRun,
      prepareUnderLease: prepareCreate(root, input),
      plan: ({ source }) => Effect.gen(function*() {
        if (source !== undefined) {
          return yield* new DesignConflict({ operation: "create", path: initial.ref, message: "Design README already exists" });
        }
        const bundle = yield* loadDesignTemplates(root);
        const planned = generateDesignPackage({
          bundle,
          createdAt,
          slug: input.slug,
          title: input.title,
          planCount: input.plans,
          cases: input.cases,
          pages: input.pages,
        });
        if (!sameManifest(generatedDirectoryManifest(planned), expectedManifest)) {
          return yield* new DesignConflict({
            operation: "create",
            path: initial.ref,
            message: "template bytes changed after the Design package was staged; retry",
          });
        }
        const readme = planned.files.find((file) => file.relativePath === "README.md");
        if (readme === undefined) return yield* new DesignConflict({ operation: "create", path: initial.ref, message: "generated Design README is missing" });
        return { bytes: readme.source, value: generatedSummary(planned), changes: { created: true as const } };
      }),
      ...(publication === undefined ? {} : {
        publication: {
          kind: "new-docs-directory" as const,
          stagePath: publication.stagePath,
          targetPath: publication.targetPath,
          expectedManifest,
        },
      }),
    });
    const mutation = input.dryRun
      ? yield* execute()
      : yield* withGeneratedStage(root, initial, execute);
    return {
      format: "concord.docs-design/create-v1",
      operation: "design-create",
      dryRun: input.dryRun,
      design: {
        slug: mutation.value.slug,
        ref: mutation.value.ref,
        title: mutation.value.title,
        state: mutation.value.state,
      },
      plans: mutation.value.plans,
      cases: mutation.value.cases,
      manifestDigests: mutation.value.manifestDigests,
      snapshotDigest: mutation.snapshotDigest,
      generation: mutation.generation,
      nextGeneration: mutation.nextGeneration,
      headCommit: mutation.headCommit,
      changedPaths: mutation.changed ? mutation.value.files.map((file) => file.path) : [],
      files: mutation.value.files,
      projectionDigest: mutation.value.projectionDigest,
    };
  });
}

function finding(code: string, path: string, message: string): DesignCheckFinding {
  return { code, path, message };
}

function pathKind(root: string, path: string): "absent" | "file" | "directory" | "invalid" {
  try {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) return "absent";
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) return "invalid";
    if (status.isFile()) return "file";
    if (status.isDirectory()) return "directory";
    return "invalid";
  } catch {
    return "invalid";
  }
}

function collectFiles(root: string, packageRoot: string): Effect.Effect<readonly DesignFileReceipt[], DesignIoError> {
  return Effect.try({
    try: () => {
      const files: DesignFileReceipt[] = [];
      const visit = (directory: string): void => {
        for (const name of readdirSync(resolve(root, directory)).sort()) {
          const path = `${directory}/${name}`;
          const status = lstatSync(resolve(root, path));
          if (status.isSymbolicLink() || (!status.isDirectory() && !status.isFile())) {
            throw new Error(`${path}: symlink or special file is forbidden`);
          }
          if (status.isDirectory()) visit(path);
          else files.push(fileReceipt(path, readFileSync(resolve(root, path), "utf8")));
        }
      };
      visit(packageRoot);
      return files.sort((left, right) => left.path.localeCompare(right.path));
    },
    catch: (cause) => new DesignIoError({ operation: "scan", path: packageRoot, message: designErrorMessage(cause) }),
  });
}

function validateManifestFiles(
  root: string,
  packageRoot: string,
  required: readonly string[],
  optional: Readonly<Record<string, readonly string[]>>,
  findings: DesignCheckFinding[],
): readonly string[] {
  for (const path of required) {
    if (pathKind(root, `${packageRoot}/${path}`) !== "file") {
      findings.push(finding("required-file-missing", `${packageRoot}/${path}`, "required template file must be a regular file"));
    }
  }
  const present: string[] = [];
  for (const [name, paths] of Object.entries(optional)) {
    const kinds = paths.map((path) => pathKind(root, `${packageRoot}/${path}`));
    if (kinds.every((kind) => kind === "file")) present.push(name);
    else if (kinds.some((kind) => kind !== "absent") || paths.some((path) =>
      dirname(path) !== "." && pathKind(root, `${packageRoot}/${dirname(path)}`) !== "absent"
    )) {
      findings.push(finding("optional-page-partial", packageRoot, `${name} optional page set must be wholly present or absent`));
    }
  }
  return present;
}

function expectedPlanSelectors(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `plan-${index + 1}`);
}

function directoryPlanSelectors(root: string, packageRoot: string): Effect.Effect<readonly string[], DesignIoError> {
  return Effect.try({
    try: () => readdirSync(resolve(root, packageRoot, "plans"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isDocumentName(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number.parseInt(left.slice("plan-".length), 10) - Number.parseInt(right.slice("plan-".length), 10)),
    catch: (cause) => new DesignIoError({ operation: "scan Plans", path: packageRoot, message: designErrorMessage(cause) }),
  });
}

function checkDesignPackage(
  root: string,
  snapshot: TraceSnapshot,
  design: TraceNode,
  bundle: DesignTemplateBundle,
): Effect.Effect<DesignCheckReceipt, DesignIoError> {
  return Effect.gen(function*() {
    const packageRoot = dirname(design.path);
    const readme = yield* readText(root, design.path);
    const declared = decodeDesignReadme(design.path, readme).alternatives;
    const plans = [...directPlans(snapshot, design)].sort((left, right) => declared.indexOf(planSelector(left.path)) - declared.indexOf(planSelector(right.path)));
    const receipts = planReceipts(root, plans, bundle);
    const directoryPlans = yield* directoryPlanSelectors(root, packageRoot);
    const state = yield* stateOf(root, design);
    const findings: DesignCheckFinding[] = [];
    const rootOptional = validateManifestFiles(
      root,
      packageRoot,
      bundle.designDecision.manifest.requiredFiles,
      bundle.designDecision.manifest.optionalFiles,
      findings,
    );
    if (plans.length === 0) findings.push(finding("plan-cardinality", design.path, "Design must contain at least one declared alternative"));
    const selectors = receipts.map((plan) => plan.selector);
    if (JSON.stringify([...directoryPlans].sort()) !== JSON.stringify([...selectors].sort())) {
      findings.push(finding("plan-node-mismatch", design.path, "every plans/plan-N directory must have one derived Design alternative"));
    }
    for (const plan of plans) {
      validateManifestFiles(
        root,
        dirname(plan.path),
        bundle.featureDesign.manifest.requiredFiles,
        bundle.featureDesign.manifest.optionalFiles,
        findings,
      );
    }
    if (state._tag === "decided" && !plans.some((plan) => plan.path === state.selectedPlan)) {
      findings.push(finding("selected-plan-invalid", design.path, "decision.selected must be one declared Design alternative"));
    }
    const expectedProjection = renderDesignProjection(receipts, state);
    const actualProjection = extractDesignProjection(readme);
    if (actualProjection === undefined) {
      findings.push(finding("projection-missing", design.path, "Design README must contain exactly one generated docs index region"));
    } else if (actualProjection !== expectedProjection) {
      findings.push(finding("projection-stale", design.path, "generated docs index bytes do not match direct Plans and selectedPlan"));
    }
    const files = yield* collectFiles(root, packageRoot);
    const content = yield* captureDesignContent(root, design.path);
    findings.push(...content.assessment.findings);
    return {
      format: "concord.docs-design/check-v1",
      operation: "design-check",
      ok: findings.length === 0,
      design: {
        slug: design.id ?? designSlug(design.path),
        ref: design.path,
        title: displayDesignTitle(design.title),
        state,
      },
      plans: receipts,
      cases: rootOptional.includes("cases"),
      manifestDigests: bundle.digests,
      snapshotDigest: snapshot.digest,
      generation: snapshot.generation,
      files,
      projectionDigest: traceDigest(expectedProjection),
      findings: findings.sort((left, right) => `${left.path}\0${left.code}`.localeCompare(`${right.path}\0${right.code}`)),
    };
  });
}

export function checkDesignAt(
  root: string,
  selector: string,
): Effect.Effect<DesignCheckReceipt, DesignCommandError, FileSystem.FileSystem> {
  return withTraceReadLease(root, () => Effect.gen(function*() {
    const snapshot = yield* compileTraceUnderLease(root);
    const design = yield* selectDesign(snapshot, selector);
    const bundle = yield* loadDesignTemplates(root);
    return yield* checkDesignPackage(root, snapshot, design, bundle);
  }));
}

interface DesignContentSnapshot {
  readonly sources: readonly (readonly [string, string])[];
  readonly assessment: DesignContentResult;
}
interface DesignPreparation extends TraceMutationPreparation {
  readonly content: DesignContentSnapshot;
  readonly plans: readonly DesignPlanReceipt[];
}

function readDesignSource(root: string, path: string): string | undefined {
  let current = root;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    if (!existsSync(current)) return undefined;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
  }
  return readFileSync(current, "utf8");
}

function captureDesignContent(root: string, path: string, selected?: string): Effect.Effect<DesignContentSnapshot, DesignIoError> {
  return Effect.try({
    try: () => {
      const owner = readDesignSource(root, path);
      if (owner === undefined) throw new Error("Design owner is missing");
      const decoded = decodeDesignReadme(path, owner);
      const base = dirname(path);
      const sources = new Map(designContentPaths(base, decoded.alternatives).map(candidate => [candidate, candidate === path ? owner : readDesignSource(root, candidate)]));
      const assessment = validateDesignContent(base, decoded.alternatives, sources, selected ?? decoded.metadata.decision?.selected);
      return { sources: [...sources].flatMap(([file, content]) => content === undefined ? [] : [[file, content] as const]), assessment };
    },
    catch: cause => new DesignIoError({ operation: "read Design content", path, message: designErrorMessage(cause) }),
  });
}

function verifyDesignPreparation(root: string, prepared: DesignPreparation): Effect.Effect<void, DesignConflict> {
  return Effect.try({
    try: () => {
      for (const [path, source] of prepared.content.sources) {
        if (readDesignSource(root, path) !== source) throw new Error(`${path} changed after validation`);
      }
      for (const preimage of prepared.preimages ?? []) {
        if (traceDigest(readFileSync(preimage.path)) !== preimage.digest) throw new Error(`${preimage.path} changed after validation`);
      }
    },
    catch: cause => new DesignConflict({ operation: "decide", path: root, message: designErrorMessage(cause) }),
  });
}

function validatedPlanTarget(snapshot: TraceSnapshot, plan: TraceNode): ValidatedRepoRefTarget {
  const validated = validateRepoRefTarget(snapshot, plan.path, ["design-plan"]);
  if (Result.isFailure(validated)) throw new DesignInputInvalid({ source: plan.path, message: validated.failure.message });
  return validated.success;
}

function prepareDecision(
  root: string,
  designSelector: string,
  requestedPlan: string,
): Effect.Effect<DesignPreparation, DesignCommandError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const snapshot = yield* compileTraceUnderLease(root);
    const design = yield* selectDesign(snapshot, designSelector);
    const state = yield* stateOf(root, design);
    if (state._tag === "decided") {
      return yield* new DesignAlreadyDecided({
        design: design.path,
        selectedPlan: state.selectedPlan,
        requestedPlan,
        message: "Design selectedPlan is immutable; record a reversal in a new Design package instead of overwriting this decision",
      });
    }
    const plan = yield* selectPlan(snapshot, design, requestedPlan);
    const bundle = yield* loadDesignTemplates(root);
    const packageCheck = yield* checkDesignPackage(root, snapshot, design, bundle);
    if (!packageCheck.ok) {
      return yield* new DesignDecisionIncomplete({
        design: design.path,
        plan: plan.path,
        findings: packageCheck.findings.map((item) => `${item.code}: ${item.path}: ${item.message}`),
        nextStep: `Fix the Design findings from pnpm run repo docs design check ${design.path} before deciding.`,
      });
    }
    const content = yield* captureDesignContent(root, design.path, planSelector(plan.path));
    if (content.assessment.findings.length) return yield* new DesignDecisionIncomplete({ design: design.path, plan: plan.path, findings: content.assessment.findings.map(item => `${item.code}: ${item.path}: ${item.message}`), nextStep: "Complete all candidate responses and the explicit DECISION selection." });
    const decoded = decodeDesignReadme(design.path, new Map(content.sources).get(design.path)!);
    if (decoded.alternatives.length !== packageCheck.plans.length || decoded.alternatives.some(selector => !packageCheck.plans.some(plan => plan.selector === selector))) {
      return yield* new DesignConflict({ operation: "decide", path: design.path, message: "Design alternatives changed while validating the package" });
    }
    const plans = decoded.alternatives.map(selector => {
      const receipt = packageCheck.plans.find(candidate => candidate.selector === selector)!;
      const planSource = new Map(content.sources).get(`${dirname(design.path)}/plans/${selector}/README.md`)!;
      return { ...receipt, title: displayPlanTitle(/^#\s+(.+)$/mu.exec(planSource)?.[1]?.trim() ?? selector) };
    });
    return {
      content,
      plans,
      generation: snapshot.generation,
      snapshotDigest: snapshot.digest,
      target: validatedPlanTarget(snapshot, plan),
      preimages: [
        ...bundle.preimages,
        ...content.sources.map(([path, source]) => ({ path: resolve(root, path), digest: traceDigest(source) })),
      ].sort((left, right) => left.path.localeCompare(right.path)),
    };
  });
}

export function decideDesignAt(
  root: string,
  designSelector: string,
  requestedPlan: string,
  dryRun: boolean,
): Effect.Effect<DesignDecideReceipt, DesignCommandError, FileSystem.FileSystem> {
  interface DecideValue {
    readonly slug: string;
    readonly ref: string;
    readonly title: string;
    readonly state: { readonly _tag: "decided"; readonly selectedPlan: string };
    readonly plans: readonly DesignPlanReceipt[];
    readonly manifestDigests: DesignTemplateBundle["digests"];
    readonly projectionDigest: string;
    readonly file: DesignFileReceipt;
  }
  interface DecideChanges { readonly selectedPlan: string }
  return Effect.gen(function*() {
    const initial = yield* withTraceReadLease(root, () => Effect.gen(function*() {
      const snapshot = yield* compileTraceUnderLease(root);
      const design = yield* selectDesign(snapshot, designSelector);
      return { path: design.path, id: design.id, digest: traceDigest(yield* readText(root, design.path)) };
    }));
    return yield* mutateTraceOwner<DecideValue, DecideChanges, DesignCommandError, FileSystem.FileSystem>({
    root,
    operation: "design-decide",
    ownerPath: initial.path,
    dryRun,
    prepareUnderLease: Effect.gen(function*() {
      const snapshot = yield* compileTraceUnderLease(root);
      const design = yield* selectDesign(snapshot, designSelector);
      if (design.path !== initial.path || design.id !== initial.id || traceDigest(yield* readText(root, design.path)) !== initial.digest) return yield* new DesignConflict({ operation: "decide", path: initial.path, message: "Design changed identity, path, or content; read it again before deciding" });
      return yield* prepareDecision(root, initial.path, requestedPlan);
    }),
    plan: ({ source, preparation }) => Effect.gen(function*() {
      const target = preparation.target;
      if (target === undefined || target.kind !== "design-plan") {
        return yield* new DesignConflict({ operation: "decide", path: designSelector, message: "validated direct Plan target is missing" });
      }
      const designPath = initial.path;
      if (source === undefined) return yield* new DesignConflict({ operation: "decide", path: designPath, message: "Design README disappeared" });
      const decoded = decodeDesignReadme(designPath, source);
      if (decoded.state._tag === "decided") {
        return yield* new DesignAlreadyDecided({
          design: designPath,
          selectedPlan: decoded.state.selectedPlan,
          requestedPlan: target.path,
          message: "Design already has an immutable selectedPlan",
        });
      }
      const prepared = preparation as DesignPreparation;
      if (new Map(prepared.content.sources).get(designPath) !== source) return yield* new DesignConflict({ operation: "decide", path: designPath, message: "Design owner changed after validation" });
      const bundle = yield* loadDesignTemplates(root);
      const plans = prepared.plans;
      const state = { _tag: "decided" as const, selectedPlan: target.path };
      const projection = renderDesignProjection(plans, state);
      const body = replaceDesignProjection(decoded.body, projection);
      if (body === undefined) {
        return yield* new DesignConflict({ operation: "decide", path: designPath, message: "Design README generated projection is missing or duplicated" });
      }
      const bytes = encodeDecidedDesignReadme(decoded, target.ref, body, prepared.content.assessment.rationale);
      const title = /^#\s+(.+)$/mu.exec(decoded.body)?.[1]?.trim() ?? designSlug(designPath);
      yield* verifyDesignPreparation(root, prepared);
      return {
        bytes,
        value: {
          slug: decoded.id,
          ref: designPath,
          title: displayDesignTitle(title),
          state,
          plans,
          manifestDigests: bundle.digests,
          projectionDigest: traceDigest(projection),
          file: fileReceipt(designPath, bytes),
        },
        changes: { selectedPlan: target.path },
      };
    }),
  }).pipe(Effect.map((mutation): DesignDecideReceipt => ({
    format: "concord.docs-design/decide-v1",
    operation: "design-decide",
    dryRun,
    design: {
      slug: mutation.value.slug,
      ref: mutation.value.ref,
      title: mutation.value.title,
      state: mutation.value.state,
    },
    plans: mutation.value.plans,
    manifestDigests: mutation.value.manifestDigests,
    snapshotDigest: mutation.snapshotDigest,
    generation: mutation.generation,
    nextGeneration: mutation.nextGeneration,
    headCommit: mutation.headCommit,
    changedPaths: mutation.changed ? [mutation.owner] : [],
    files: [mutation.value.file],
    projectionDigest: mutation.value.projectionDigest,
    selectedPlan: mutation.value.state.selectedPlan,
  })));
  });
}

export function runDesignCommandAt(
  root: string,
  input: unknown,
): Effect.Effect<DesignReceipt, DesignCommandError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const decoded = yield* decodeDesignCommandInput(input);
    switch (decoded.command) {
      case "create":
        return yield* createDesignAt(root, normalizeCreate(decoded));
      case "check":
        return yield* checkDesignAt(root, decoded.design);
      case "decide":
        return yield* decideDesignAt(root, decoded.design, decoded.plan, decoded.dryRun ?? false);
    }
  });
}

export const DESIGN_REPOSITORY_ROOT = repositoryRoot();

export function runDesignCommand(input: unknown) {
  return runDesignCommandAt(DESIGN_REPOSITORY_ROOT, input);
}
