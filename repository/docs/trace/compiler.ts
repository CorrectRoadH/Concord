import * as FileSystem from "effect/FileSystem";
import { createHash } from "node:crypto";
import { join, posix, relative, sep } from "node:path";
import { Effect, Result, Schema, SchemaIssue } from "effect";
import { parse } from "yaml";
import { DocumentSchema } from 'concord-sdlc/model';
import type { DocumentRecord } from 'concord-sdlc/model';
import { decodeDocumentSource } from 'concord-sdlc/document-codec';
import { documentDisposition, documentPlacementError, validPackagePath, validDesignPlanPath } from 'concord-sdlc/document-layout';

import { decodeFeedbackDocument } from "../../feedback/codec.js";
import { decodeMemoryDocument } from "../../memory/codec.js";
import { repositoryConfiguration } from "../../root.js";
import { decodeCaseDeclarations, decodeCaseArchive } from "../test-case/annotations.js";
import {
  TraceFormatError,
  TraceInputChanged,
  TraceIoError,
  TraceMutationActive,
  TraceSnapshotChanged,
  type TraceError,
} from "./errors.js";
import { markdownAnchor, parseRepoRef, RepoRefSchema, validateRepoRefTarget } from "./ref.js";
import {
  readTraceGeneration,
  withTraceReadLease,
  TraceMutationError,
} from "./relation-mutation.js";
import type {
  DocsNodeKind,
  TraceFeedback,
  TraceMemory,
  TraceNode,
  TracePage,
  TracePageRole,
  TraceSnapshot,
  TraceTest,
} from "./model.js";
import { ADOPTABLE_DOCS_NODE_KINDS, DOCS_NODE_KINDS } from "./model.js";

const sorted = <A>(items: readonly A[], key: (item: A) => string): readonly A[] =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)));
const slash = (path: string): string => path.split(sep).join("/");
const digest = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const pure = <A>(
  path: string,
  subject: string,
  thunk: () => A,
): Effect.Effect<A, TraceFormatError> => Effect.try({
  try: thunk,
  catch: (cause) => cause instanceof TraceFormatError
    ? cause
    : new TraceFormatError({ path, subject, message: message(cause) }),
});

function referenceParts(reference: string): { readonly path: string; readonly anchor?: string } {
  const parsed = parseRepoRef(reference);
  if (Result.isFailure(parsed)) throw new Error(parsed.failure.message);
  return parsed.success.anchor === undefined
    ? { path: parsed.success.path }
    : { path: parsed.success.path, anchor: parsed.success.anchor };
}

function parseFrontmatter(path: string, text: string): { readonly value: unknown; readonly body: string } | undefined {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return undefined;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new TraceFormatError({ path, subject: "frontmatter", message: "missing closing delimiter" });
  }
  try {
    return { value: parse(match[1]) as unknown, body: match[2] };
  } catch (cause) {
    throw new TraceFormatError({ path, subject: "frontmatter", message: message(cause) });
  }
}

function decodeNode(record: DocumentRecord, owners: readonly DocumentRecord[]): TraceNode | undefined {
  const { path, metadata } = record;
  if (metadata.kind === 'research' || metadata.kind === 'issue' || metadata.kind === 'memory') return undefined;
  const features = metadata.kind === 'use-case' ? owners.filter(owner => owner.metadata.kind === 'feature' && owner.path === metadata.feature) : [];
  const featurePath = features.length === 1 ? features[0]!.path : undefined;
  const placement = documentPlacementError(metadata.kind, path, featurePath);
  if (placement !== undefined) throw new TraceFormatError({ path, subject: 'placement', message: placement });
  if (metadata.kind === "design" && metadata.decision !== undefined && !metadata.alternatives.includes(metadata.decision.selected)) {
    throw new TraceFormatError({ path, subject: "decision", message: "decision.selected must be one declared alternative" });
  }
  const relations: Record<string, readonly string[]> = {};
  if (metadata.kind === "feature" && metadata.origin !== undefined) relations.buildsOn = [metadata.origin];
  if (metadata.kind === "use-case") relations.composes = [featurePath!];
  if (metadata.kind === "design" && metadata.decision !== undefined) {
    relations.selectedPlan = [`${posix.dirname(path)}/plans/${metadata.decision.selected}/README.md`];
    if (metadata.decision.targets.length > 0) relations.decides = [...metadata.decision.targets].sort();
  }
  return {
    kind: metadata.kind,
    id: metadata.id,
    path,
    title: metadata.title,
    relations,
  };
}

function validNodePlacement(node: TraceNode): boolean {
  switch (node.kind) {
    case "feature":
    case "roadmap":
    case "engineering":
    case "design":
      return validPackagePath(node.kind, node.path);
    case "design-plan":
      return validDesignPlanPath(node.path);
    case "use-case":
      return documentPlacementError('use-case', node.path, node.relations.composes?.[0]) === undefined;
  }
}

function deriveDesignPlans(nodes: readonly TraceNode[], documents: readonly (readonly [string, string])[]): readonly TraceNode[] {
  const sources = new Map(documents);
  return nodes.flatMap((design): TraceNode[] => {
    if (design.kind !== "design") return [];
    const source = sources.get(design.path);
    if (source === undefined) return [];
    const parsed = parseFrontmatter(design.path, source);
    if (parsed === undefined) return [];
    const decoded = Schema.decodeUnknownResult(DocumentSchema, { errors: "all", onExcessProperty: "error" })(parsed.value);
    if (Result.isFailure(decoded) || decoded.success.kind !== "design") return [];
    return decoded.success.alternatives.flatMap((alternative): TraceNode[] => {
      const path = `${posix.dirname(design.path)}/plans/${alternative}/README.md`;
      const plan = sources.get(path);
      return plan === undefined ? [] : [{ kind: "design-plan", path, title: markdownTitle(path, plan), relations: {} }];
    });
  });
}

function markdownTitle(path: string, source: string): string {
  const parsed = parseFrontmatter(path, source);
  const body = parsed?.body ?? source;
  return /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() ?? path;
}

function featureForPath(nodes: readonly TraceNode[], path: string): TraceNode | undefined {
  return nodes
    .filter((node) => node.kind === "feature" &&
      path.startsWith(node.path.slice(0, -"README.md".length)))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function isInsideUseCaseBoundary(nodes: readonly TraceNode[], path: string): boolean {
  return nodes.some((node) => node.kind === "use-case" && node.path.endsWith("/README.md") &&
    path !== node.path && path.startsWith(node.path.slice(0, -"README.md".length)));
}

function pageRole(featurePath: string, pagePath: string): TracePageRole {
  const featureRoot = featurePath.slice(0, -"README.md".length);
  const placement = pagePath.slice(featureRoot.length);
  if (placement === "README.md") return "overview";
  if (placement === "library.md" || placement.startsWith("library/")) return "library";
  if (placement === "cli.md" || placement.startsWith("cli/")) return "cli";
  if (placement === "architecture.md" || placement.startsWith("architecture/")) return "architecture";
  if (placement === "lifecycle.md" || placement.startsWith("lifecycle/")) return "lifecycle";
  if (placement.startsWith("reference/")) return "reference";
  return "supporting";
}

function deriveFeaturePages(
  nodes: readonly TraceNode[],
  documents: readonly (readonly [string, string])[],
): readonly TracePage[] {
  const useCases = nodes.filter((node) => node.kind === "use-case");
  return sorted(nodes.flatMap((feature): TracePage[] => {
    if (feature.kind !== "feature") return [];
    return documents.flatMap(([path, source]): TracePage[] => {
      if (featureForPath(nodes, path)?.path !== feature.path) return [];
      const insideUseCase = useCases.some((useCase) => {
        if (path === useCase.path) return true;
        return useCase.path.endsWith("/README.md") &&
          path.startsWith(useCase.path.slice(0, -"README.md".length));
      });
      if (insideUseCase) return [];
      return [{
        path,
        title: markdownTitle(path, source),
        role: pageRole(feature.path, path),
        feature: feature.path,
      }];
    });
  }), (page) => page.path);
}

function hasHeading(source: string, anchor: string): boolean {
  return source.split(/\r?\n/u).some((line) => markdownAnchor(line) === anchor);
}

function validateReferenceTarget(
  sourcePath: string,
  subject: string,
  reference: string,
  documentIndex: ReadonlyMap<string, string>,
): string {
  const target = referenceParts(reference);
  const source = documentIndex.get(target.path);
  if (source === undefined) {
    throw new TraceFormatError({
      path: sourcePath,
      subject,
      message: `target file ${target.path} does not exist`,
    });
  }
  if (target.anchor !== undefined && (target.anchor.length === 0 || !hasHeading(source, target.anchor))) {
    throw new TraceFormatError({
      path: sourcePath,
      subject,
      message: `target anchor ${target.anchor || "<empty>"} does not exist`,
    });
  }
  return target.path;
}

function validateNodeRelations(
  snapshot: TraceSnapshot,
  documentIndex: ReadonlyMap<string, string>,
): void {
  const targetKinds: Readonly<Record<string, readonly DocsNodeKind[]>> = {
    buildsOn: ["feature", "roadmap"],
    supports: ["feature", "roadmap", "engineering"],
    selectedPlan: ["design-plan"],
    decides: ["feature", "roadmap", "engineering"],
    composes: ["use-case", "feature"],
  };
  const roadmapGraph = new Map<string, Set<string>>();
  for (const node of snapshot.nodes) {
    if (!validNodePlacement(node)) {
      throw new TraceFormatError({ path: node.path, subject: "placement", message: `${node.kind} is not valid at this path` });
    }
    if (node.kind === "use-case") {
      const composes = node.relations.composes ?? [];
      if (composes.length !== 1) throw new TraceFormatError({ path: node.path, subject: "feature", message: "concord.document/v1 Use Case must name exactly one Feature" });
    }
    if (node.kind === "roadmap") roadmapGraph.set(node.path, new Set());
    for (const [relation, references] of Object.entries(node.relations)) {
      for (const reference of references) {
        const targetPath = referenceParts(reference).path;
        const permitted = targetKinds[relation] ?? [];
        const target = validateRepoRefTarget(
          snapshot,
          reference,
          permitted,
          documentIndex.get(targetPath),
        );
        if (Result.isFailure(target)) {
          throw new TraceFormatError({
            path: node.path,
            subject: relation,
            message: target.failure.message,
          });
        }
        if (target.success.owner.path === node.path) {
          throw new TraceFormatError({ path: node.path, subject: relation, message: "must not be a self-reference" });
        }
        if (
          relation === "selectedPlan" &&
          posix.dirname(posix.dirname(posix.dirname(target.success.path))) !== posix.dirname(node.path)
        ) {
          throw new TraceFormatError({
            path: node.path,
            subject: relation,
            message: "must target a directly contained Design Plan",
          });
        }
        if (relation === "composes") {
          if (target.success.kind === "use-case" && (target.success.owner.relations.composes?.length ?? 0) > 0) {
            throw new TraceFormatError({ path: node.path, subject: relation, message: "must target a leaf Use Case" });
          }
        }
        if (node.kind === "roadmap" && relation === "buildsOn" && target.success.kind === "roadmap") {
          roadmapGraph.get(node.path)?.add(target.success.owner.path);
        }
      }
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (path: string): void => {
    if (active.has(path)) throw new TraceFormatError({ path, subject: "buildsOn", message: "Roadmap cycle" });
    if (visited.has(path)) return;
    active.add(path);
    for (const target of roadmapGraph.get(path) ?? []) visit(target);
    active.delete(path);
    visited.add(path);
  };
  for (const path of [...roadmapGraph.keys()].sort()) visit(path);
}

function featuresForContract(nodes: readonly TraceNode[], contractPath: string): readonly TraceNode[] {
  const useCase = nodes.find((node) => node.kind === "use-case" && node.path === contractPath);
  if (useCase !== undefined) {
    const composed = useCase.relations.composes ?? [];
    if (composed.length === 0) {
      const owner = featureForPath(nodes, contractPath);
      return owner === undefined ? [] : [owner];
    }
    return [
      ...new Map(
        composed
          .map((reference) => referenceParts(reference).path)
          .map((path) => featureForPath(nodes, path))
          .filter((node): node is TraceNode => node !== undefined)
          .map((node) => [node.path, node]),
      ).values(),
    ];
  }
  if (isInsideUseCaseBoundary(nodes, contractPath)) return [];
  const owner = featureForPath(nodes, contractPath);
  return owner === undefined ? [] : [owner];
}

function validateRegressions(
  tests: readonly TraceTest[],
  memory: readonly TraceMemory[],
  memorySources: ReadonlyMap<string, string>,
): void {
  const memoryByPath = new Map(memory.map((entry) => [entry.path, entry]));
  for (const test of tests) {
    for (const reference of test.regressions) {
      const targetPath = validateReferenceTarget(test.path, "regression", reference, memorySources);
      const target = memoryByPath.get(targetPath);
      if (target === undefined) {
        throw new TraceFormatError({
          path: test.path,
          subject: "regression",
          message: `target ${reference} is not a Memory document`,
        });
      }
      if (target.kind !== "problem") {
        throw new TraceFormatError({
          path: test.path,
          subject: "regression",
          message: `structured target ${reference} must be a Problem Memory`,
        });
      }
    }
  }
}

function validateScopedRepoRef(
  sourcePath: string,
  subject: string,
  reference: string,
  snapshot: TraceSnapshot,
  documents: ReadonlyMap<string, string>,
  expectedKinds: readonly DocsNodeKind[],
): DocsNodeKind {
  const targetPath = referenceParts(reference).path;
  const validated = validateRepoRefTarget(snapshot, reference, expectedKinds, documents.get(targetPath));
  if (Result.isFailure(validated)) {
    throw new TraceFormatError({ path: sourcePath, subject, message: validated.failure.message });
  }
  if (!validated.success.directNode && isInsideUseCaseBoundary(snapshot.nodes, targetPath)) {
    throw new TraceFormatError({
      path: sourcePath,
      subject,
      message: `supporting target ${reference} is inside a Use Case boundary; target the exact Use Case node`,
    });
  }
  return validated.success.kind;
}

function validateFeedbackRelations(
  feedback: readonly TraceFeedback[],
  snapshot: TraceSnapshot,
  documents: ReadonlyMap<string, string>,
  memory: readonly TraceMemory[],
): void {
  const memoryIds = new Set(memory.map((entry) => entry.path));
  for (const entry of feedback) {
    for (const target of entry.adoptions.current) {
      validateScopedRepoRef(
        entry.path,
        "adoption",
        target,
        snapshot,
        documents,
        ADOPTABLE_DOCS_NODE_KINDS,
      );
    }
    for (const relation of entry.memoryRelations) {
      if (!memoryIds.has(relation.memory)) {
        throw new TraceFormatError({
          path: entry.path,
          subject: "memory relation",
          message: `Memory ${relation.memory} does not exist`,
        });
      }
    }
  }
}

function validateMemoryPromotions(
  memory: readonly TraceMemory[],
  snapshot: TraceSnapshot,
  documents: ReadonlyMap<string, string>,
): void {
  for (const entry of memory) {
    for (const promotion of entry.promotions) {
      for (const target of promotion.current) {
        validateScopedRepoRef(entry.path, "promotion", target, snapshot, documents, ADOPTABLE_DOCS_NODE_KINDS);
      }
    }
  }
}

function walk(directory: string): Effect.Effect<readonly string[], TraceIoError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(directory).pipe(
      Effect.mapError((cause) => new TraceIoError({
        operation: "scan",
        path: directory,
        message: message(cause),
      })),
    );
    const nested = yield* Effect.forEach(entries, (entry) => {
      if (
        entry.startsWith(".stage-") ||
        entry === "node_modules" ||
        entry === ".git"
      ) return Effect.succeed([] as readonly string[]);
      const path = join(directory, entry);
      return fs.stat(path).pipe(
        Effect.mapError((cause) => new TraceIoError({ operation: "scan", path, message: message(cause) })),
        Effect.flatMap((status) => status.type === "Directory"
          ? walk(path)
          : status.type === "File"
            ? Effect.succeed([path])
            : Effect.fail(new TraceIoError({ operation: "scan", path, message: `unsupported ${status.type} entry` }))),
      );
    });
    return nested.flat();
  });
}

type RepositoryConfiguration = ReturnType<typeof repositoryConfiguration>["config"];
const inDirectory = (file: string, directory: string): boolean => file === directory || file.startsWith(`${directory}/`);

function traceInputPaths(root: string, paths: readonly string[], config: RepositoryConfiguration): readonly string[] {
  return sorted(paths.filter((path) => {
    const file = slash(relative(root, path));
    if (/^docs\/.*\.md$/u.test(file)) return true;
    if (/^memory\/.*\.md$/u.test(file)) return true;
    if (file === config.historyPath) return true;
    return /\.(?:[cm]?[jt]sx?)$/u.test(file) && config.suites.some(suite => inDirectory(file, suite.root));
  }), (path) => slash(relative(root, path)));
}

function changedInputs(
  root: string,
  firstPaths: readonly string[],
  secondPaths: readonly string[],
  firstSources: ReadonlyMap<string, string>,
  secondSources: ReadonlyMap<string, string>,
): readonly string[] {
  const changed = new Set<string>();
  const firstRelative = new Set(firstPaths.map((path) => slash(relative(root, path))));
  const secondRelative = new Set(secondPaths.map((path) => slash(relative(root, path))));
  for (const path of firstRelative) if (!secondRelative.has(path)) changed.add(path);
  for (const path of secondRelative) if (!firstRelative.has(path)) changed.add(path);
  for (const path of firstPaths) {
    if (secondSources.get(path) !== firstSources.get(path)) changed.add(slash(relative(root, path)));
  }
  return [...changed].sort();
}

function compileTraceAtGeneration(
  root: string,
  generation: number,
  attempt: number,
): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const profile = yield* pure("concord.repository.json", "configuration", () => repositoryConfiguration(root));
    const scan = Effect.fn("repository.trace.scanGovernedInputs")(function*() {
      const directories = [...new Set(["docs", "memory", ...profile.config.suites.map(suite => suite.root)])];
      const groups = yield* Effect.forEach(directories, directory => walk(join(root, directory)));
      const files = new Set(groups.flat());
      const history = join(root, profile.config.historyPath);
      const historyExists = yield* fs.exists(history).pipe(Effect.mapError(cause => new TraceIoError({
        operation: "scan",
        path: profile.config.historyPath,
        message: message(cause),
      })));
      if (historyExists) files.add(history);
      return [...files];
    });
    const firstAll = yield* scan();
    const firstInputs = traceInputPaths(root, firstAll, profile.config);
    const firstPairs = yield* Effect.forEach(firstInputs, (path) => fs.readFileString(path).pipe(
      Effect.map((source) => [path, source] as const),
      Effect.mapError((cause) => new TraceIoError({
        operation: "read",
        path: slash(relative(root, path)),
        message: message(cause),
      })),
    ));
    const secondAll = yield* scan();
    const secondInputs = traceInputPaths(root, secondAll, profile.config);
    const secondPairs = yield* Effect.forEach(secondInputs, (path) => fs.readFileString(path).pipe(
      Effect.map((source) => [path, source] as const),
      Effect.mapError((cause) => new TraceIoError({
        operation: "read",
        path: slash(relative(root, path)),
        message: message(cause),
      })),
    ));
    const firstSources = new Map(firstPairs);
    const capturedSources = new Map(secondPairs);
    const changed = [...changedInputs(root, firstInputs, secondInputs, firstSources, capturedSources)];
    const currentProfile = yield* pure("concord.repository.json", "configuration", () => repositoryConfiguration(root));
    if (currentProfile.digest !== profile.digest) changed.push("concord.repository.json");
    if (changed.length > 0) {
      return yield* new TraceInputChanged({ path: root, attempts: attempt, changed });
    }
    const all = secondAll;
    const relativeFiles = new Set(all.map((path) => slash(relative(root, path))));
    const read = (path: string): Effect.Effect<string, TraceIoError> => {
      const source = capturedSources.get(path);
      return source === undefined
        ? Effect.fail(new TraceIoError({
            operation: "read",
            path: slash(relative(root, path)),
            message: "file was not part of the stable Trace input capture",
          }))
        : Effect.succeed(source);
    };

    const docFiles = all.filter((path) => path.startsWith(join(root, "docs") + sep) && path.endsWith(".md"));
    const documentSources = yield* Effect.forEach(docFiles, (path) => read(path).pipe(
      Effect.map((source) => [slash(relative(root, path)), source] as const),
    ));
    const documentIndex = new Map(documentSources);
    const ownerValues = yield* Effect.forEach(
      documentSources,
      ([path, source]) => pure(path, "frontmatter", () => decodeDocumentSource(path, source)),
    );
    const owners = ownerValues.filter((owner): owner is DocumentRecord => owner !== undefined && documentDisposition(owner.metadata.kind, owner.path, ['memory']) === 'current');
    const identities = new Set<string>();
    for (const owner of owners) {
      if (owner.metadata.kind === 'memory') continue;
      if (owner.metadata.kind !== 'use-case') {
        const placement = documentPlacementError(owner.metadata.kind, owner.path);
        if (placement !== undefined) return yield* new TraceFormatError({ path: owner.path, subject: 'placement', message: placement });
      }
      const identity = `${owner.metadata.kind}:${owner.metadata.id}`;
      if (identities.has(identity)) return yield* new TraceFormatError({ path: owner.path, subject: 'identity', message: `${identity} is not unique` });
      identities.add(identity);
    }
    const nodeValues = yield* Effect.forEach(owners, owner => pure(owner.path, 'placement', () => decodeNode(owner, owners)));
    const parsedNodes = nodeValues.filter((item): item is TraceNode => item !== undefined);
    const nodes = sorted(
      [...parsedNodes, ...deriveDesignPlans(parsedNodes, documentSources)],
      (item) => item.path,
    );
    const pages = deriveFeaturePages(nodes, documentSources);
    const targetSnapshot: TraceSnapshot = {
      digest: "",
      generation,
      nodes,
      pages,
      tests: [],
      feedback: [],
      memory: [],
    };
    yield* pure("docs", "relations", () => validateNodeRelations(targetSnapshot, documentIndex));

    const annotationFiles = all.filter((path) => {
      const file = slash(relative(root, path));
      return file !== profile.config.historyPath && /\.(?:[cm]?[jt]sx?)$/u.test(file)
        && profile.config.suites.some(suite => inDirectory(file, suite.root));
    });
    const candidateSources = yield* Effect.forEach(annotationFiles, (path) => read(path).pipe(
      Effect.map((source) => ({ path: slash(relative(root, path)), source })),
    ));
    const knownCaseIds = new Map<string, string>();
    const tests: TraceTest[] = [];

    const annotated = [] as import("../test-case/annotations.js").CaseDeclaration[];
    for (const candidate of candidateSources) {
      const decoded = decodeCaseDeclarations(candidate.path, candidate.source);
      if (Result.isFailure(decoded)) return yield* Effect.fail(new TraceFormatError({
        path: candidate.path,
        subject: "case relations",
        message: decoded.failure.message,
      }));
      annotated.push(...decoded.success);
    }
    const historyPath = profile.config.historyPath;
    const archived = relativeFiles.has(historyPath) ? decodeCaseArchive(historyPath, yield* read(join(root, historyPath))) : Result.succeed({ history: [], tombstones: [] });
    if (Result.isFailure(archived)) return yield* Effect.fail(new TraceFormatError({ path: historyPath, subject: "case history", message: archived.failure.message }));
    for (const item of annotated) {
      if (!relativeFiles.has(item.testFile)) return yield* Effect.fail(new TraceFormatError({ path: item.declarationPath, subject: "testFile", message: `${item.testFile} does not exist` }));
      {
        const caseId = item.caseId;
        const previous = knownCaseIds.get(caseId);
        if (previous !== undefined) return yield* Effect.fail(new TraceFormatError({
          path: item.declarationPath,
          subject: "caseId",
          message: `${caseId} is already owned by ${previous}`,
        }));
        knownCaseIds.set(caseId, item.declarationPath);
      }

      const contract = item.contract;
      if (item.contract !== undefined) {
        const contractPath = referenceParts(contract).path;
        const target = validateRepoRefTarget(targetSnapshot, contract, ["feature", "use-case"], documentIndex.get(contractPath));
        if (Result.isFailure(target)) return yield* Effect.fail(new TraceFormatError({
          path: item.declarationPath, subject: "contract", message: target.failure.message,
        }));
        if (target.success.kind !== item.contractKind) return yield* Effect.fail(new TraceFormatError({
          path: item.declarationPath, subject: "contract", message: `@${item.contractKind} must point to a ${item.contractKind} contract`,
        }));
        if (featuresForContract(nodes, target.success.path).length === 0) return yield* Effect.fail(new TraceFormatError({
          path: item.declarationPath, subject: "contract", message: `${contract} is not a Feature contract or composed Use Case`,
        }));
      }

      const suites = profile.config.suites.filter(suite => inDirectory(item.testFile, suite.root));
      if (suites.length !== 1) {
        return yield* Effect.fail(new TraceFormatError({
          path: item.declarationPath,
          subject: "suite",
          message: `${item.testFile} must belong to exactly one configured suite`,
        }));
      }
      const suite = suites[0]!;
      if (!inDirectory(item.declarationPath, suite.root)) {
        return yield* Effect.fail(new TraceFormatError({
          path: item.declarationPath,
          subject: "suite",
          message: `declaration helper and native test must belong to suite ${suite.id}`,
        }));
      }
      {
        tests.push({
          caseId: item.caseId,
          title: item.title,
          selector: `${item.testFile}#${item.caseId}`,
          path: item.testFile,
          contract,
          regressions: [...item.regressions],
          issues: item.issues.map((issue) => issue.url),
          suite: suite.id,
        });
      }
    }
    for (const entry of archived.success.tombstones) {
      const previous = knownCaseIds.get(entry.event.caseId);
      if (previous !== undefined) return yield* Effect.fail(new TraceFormatError({ path: historyPath, subject: "caseId", message: `${entry.event.caseId} is already current at ${previous}` }));
      knownCaseIds.set(entry.event.caseId, historyPath);
    }

    const memoryFiles = all.filter((path) =>
      path.startsWith(join(root, "memory") + sep) && path.endsWith(".md")
    );
    const allMemorySources = yield* Effect.forEach(memoryFiles, (path) => read(path).pipe(
      Effect.map((source) => [slash(relative(root, path)), source] as const),
    ));
    const memorySources = yield* pure('memory', 'classification', () => allMemorySources.filter(([path, source]) => decodeDocumentSource(path, source)?.metadata.kind === 'memory'));
    const memorySourceIndex = new Map(memorySources);
    const memory = yield* Effect.forEach(memorySources, ([relativePath, source]) => pure(
      relativePath,
      "memory",
      (): TraceMemory => {
        const decoded = decodeMemoryDocument(
          relativePath,
          relativePath.slice("memory/".length, -".md".length),
          source,
        );
        return {
          path: relativePath,
          id: decoded.metadata.id,
          title: decoded.metadata.title,
          kind: decoded.metadata.memoryKind,
          state: decoded.metadata.state,
          promotions: [{
            kind: "promotion",
            current: sorted(decoded.metadata.promotions, (target) => target),
            history: decoded.metadata.history
              .flatMap((entry) => entry.action !== "promote" && entry.action !== "retire-promotion"
                ? []
                : entry.ref === undefined
                  ? []
                  : [{ at: entry.at, action: entry.action, reason: entry.reason, ref: entry.ref, ...(entry.commit === undefined ? {} : { commit: entry.commit }) }]),
          }],
          metadataDigest: digest(decoded.metadata),
        };
      },
    ));
    yield* pure(
      "memory",
      "regression",
      () => validateRegressions(tests, memory, memorySourceIndex),
    );

    const feedbackFiles = owners.filter(owner => owner.metadata.kind === 'issue').map(owner => join(root, owner.path));
    const feedback = yield* Effect.forEach(feedbackFiles, (path) => read(path).pipe(
      Effect.flatMap((source) => {
        const relativePath = slash(relative(root, path));
        return pure(relativePath, "feedback", (): TraceFeedback => {
          const { metadata } = decodeFeedbackDocument(relativePath, source);
          const current = sorted(metadata.adoptions.current, (target) => target);
          const history = sorted(metadata.adoptions.history, (item) => `${item.target}\0${item.commit}`);
          const memoryRelations = sorted(metadata.memoryRelations, (relation) => `${relation.kind}\0${relation.memory}`);
          return {
            path: relativePath,
            id: metadata.id,
            title: metadata.title,
            state: metadata.state,
            ...(metadata.subject === undefined ? {} : { subject: metadata.subject }),
            ...(metadata.claim === undefined ? {} : { claim: metadata.claim }),
            adoptions: { current, history },
            memoryRelations,
            metadataDigest: digest({
              ...metadata,
              adoptions: { current, history },
              memoryRelations,
            }),
          };
        });
      }),
    ));
    const raw = {
      generation,
      nodes,
      pages,
      tests: sorted(tests, (item) => item.selector),
      feedback: sorted(feedback, (item) => item.path),
      memory: sorted(memory, (item) => item.path),
    };
    const snapshot: TraceSnapshot = { ...raw, digest: digest(raw) };
    yield* pure("memory", "promotion", () => validateMemoryPromotions(memory, snapshot, documentIndex));
    yield* pure(
      "feedback",
      "relations",
      () => validateFeedbackRelations(feedback, snapshot, documentIndex, memory),
    );
    return snapshot;
  });
}

const maximumStableReadAttempts = 3;

function readTraceConsistency<A>(
  root: string,
  read: Effect.Effect<A, TraceMutationError>,
): Effect.Effect<A, TraceIoError> {
  return read.pipe(Effect.mapError((cause) => new TraceIoError({
    operation: "read",
    path: cause.path ?? root,
    message: `${cause.phase}: ${cause.message}`,
  })));
}

function compileStableTrace(
  root: string,
  attempt: number,
): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const before = yield* readTraceConsistency(root, readTraceGeneration(root));
    const compiled = yield* Effect.result(compileTraceAtGeneration(root, before, attempt));
    const after = yield* readTraceConsistency(root, readTraceGeneration(root));
    if (after !== before) {
      if (attempt < maximumStableReadAttempts) {
        yield* Effect.yieldNow;
        return yield* compileStableTrace(root, attempt + 1);
      }
      return yield* new TraceSnapshotChanged({
        path: root,
        before,
        after,
        attempts: attempt,
      });
    }
    if (Result.isFailure(compiled)) {
      if (compiled.failure instanceof TraceInputChanged && attempt < maximumStableReadAttempts) {
        yield* Effect.yieldNow;
        return yield* compileStableTrace(root, attempt + 1);
      }
      return yield* Effect.fail(compiled.failure);
    }
    return compiled.success;
  });
}

export function compileTrace(root: string): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return withTraceReadLease(root, () => compileStableTrace(root, 1)).pipe(
    Effect.mapError((error) => {
      if (!(error instanceof TraceMutationError)) return error;
      if (error.phase === "lock" && error.message.includes("busy")) {
        return new TraceMutationActive({ path: error.path ?? root, attempts: 1 });
      }
      return new TraceIoError({ operation: "read", path: error.path ?? root, message: error.message });
    }),
  );
}

/** Internal entry for a caller already holding the repo-wide shared/exclusive Trace lease. */
export function compileTraceUnderLease(root: string): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return compileStableTrace(root, 1);
}
