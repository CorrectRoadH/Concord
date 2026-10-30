import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import * as FileSystem from "effect/FileSystem";
import { createHash } from "node:crypto";
import { join, posix, relative, sep } from "node:path";
import { Effect, Result, Schema, SchemaIssue } from "effect";
import { parse } from "yaml";
import { DocumentSchema } from 'concord-sdlc/model';
import type { DocumentRecord } from 'concord-sdlc/model';
import { decodeDocumentSource, deriveDesignRecord, documentTitle } from 'concord-sdlc/document-codec';
import { documentDisposition, documentPlacementError, validPackagePath, validDesignPlanPath, readDesignPlanPaths } from 'concord-sdlc/document-layout';

import {
  TraceFormatError,
  TraceIncomplete,
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
  TraceFinding,
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

function decodeNode(record: DocumentRecord, owners: readonly DocumentRecord[], root: string): TraceNode | undefined {
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
  if (metadata.kind === "feature") {
    const adopted = owners.flatMap(owner => owner.metadata.kind === "roadmap" && owner.metadata.adoptedAs === path ? [owner.path] : []).sort();
    if (adopted.length > 0) relations.buildsOn = adopted;
  }
  if (metadata.kind === "use-case") relations.composes = [featurePath!];
  if (metadata.kind === "design" && metadata.decision !== undefined) {
    relations.selectedPlan = [readDesignPlanPaths(root, posix.dirname(path), metadata.alternatives).get(metadata.decision.selected)!];
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

function deriveDesignPlans(nodes: readonly TraceNode[], documents: readonly (readonly [string, string])[], root: string): readonly TraceNode[] {
  const sources = new Map(documents);
  return nodes.flatMap((design): TraceNode[] => {
    if (design.kind !== "design") return [];
    const source = sources.get(design.path);
    if (source === undefined) return [];
    const entries = readDesignPlanPaths(root, posix.dirname(design.path));
    return [...entries.keys()].flatMap((alternative): TraceNode[] => {
      const path = entries.get(alternative)!;
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
          (target.success.path.endsWith('/README.md')
            ? posix.dirname(posix.dirname(posix.dirname(target.success.path)))
            : posix.dirname(posix.dirname(target.success.path))) !== posix.dirname(node.path)
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

/** Reuse the current compiler; repository APIs do not read legacy profiles. */
function compileTraceAtGeneration(root: string, generation: number, _attempt: number, findings?: TraceFinding[]): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const source = import.meta.url.endsWith('.ts');
    const storagePath = source ? '../../../src/storage.ts' : '../../../storage.js';
    const configPath = source ? '../../../src/config.ts' : '../../../config.js';
    const tracePath = source ? '../../../src/trace.ts' : '../../../trace.js';
    type Repo = import('concord-sdlc/model').Repository;
    type CurrentTrace = { documents: readonly DocumentRecord[]; annotations: { cases: readonly import('concord-sdlc/model').AnnotatedCase[] }; findings: readonly { path: string; code: string; message: string }[]; complete: boolean };
    const modules = yield* Effect.tryPromise({
      try: async () => ({ storage: await import(storagePath) as { canonicalPath(path: string): string }, config: await import(configPath) as { snapshot(path: 'concord.config.ts', source: string): import('concord-sdlc/model').ConfigSnapshot }, trace: await import(tracePath) as { buildTrace(repo: Repo, cache: 'off', options: object): CurrentTrace } }),
      catch: cause => new TraceIoError({ operation: 'read', path: root, message: message(cause) }),
    });
    return yield* pure(root, 'sources', () => {
      const capture = (): Map<string, string> => {
        const sources = new Map<string, string>();
        const visit = (directory: string): void => {
          const parts = directory.split('/');
          for (let end = 1; end <= parts.length; end++) if (lstatSync(join(root, ...parts.slice(0, end)), { throwIfNoEntry: false })?.isSymbolicLink()) throw new TraceIoError({ operation: 'read', path: directory, message: 'Source path has a symbolic-link component' });
          const absolute = join(root, directory); const stat = lstatSync(absolute, { throwIfNoEntry: false });
          if (!stat) return;
          if (stat.isSymbolicLink()) throw new TraceIoError({ operation: 'read', path: directory, message: 'Symbolic links are not supported in repository sources' });
          if (stat.isDirectory()) { for (const name of readdirSync(absolute).sort()) if (!['.git', 'node_modules', 'dist', '.test-results'].includes(name)) visit(directory ? `${directory}/${name}` : name); }
          else if (stat.isFile()) sources.set(directory, readFileSync(absolute, 'utf8'));
          else throw new TraceIoError({ operation: 'read', path: directory, message: 'Source is not a regular file' });
        };
        visit('concord.config.ts');
        const config = sources.has('concord.config.ts') ? modules.config.snapshot('concord.config.ts', sources.get('concord.config.ts')!).config : {};
        for (const directory of new Set(['docs', 'memory', ...(config.testRoots ?? ['test', 'tests'])])) { modules.storage.canonicalPath(directory); visit(directory); }
        return sources;
      };
      const captured = capture();
      const configSnapshot: import('concord-sdlc/model').ConfigSnapshot = captured.has('concord.config.ts') ? modules.config.snapshot('concord.config.ts', captured.get('concord.config.ts')!) : { path: 'concord.config.ts', source: '', digest: `sha256:${createHash('sha256').update('').digest('hex')}`, config: {} };
      const repo: Repo = {
        root, privateDir: join(root, '.git/concord'), access: 'read', persistentCache: 'off', configSnapshot,
        config: { ...configSnapshot.config, testRoots: configSnapshot.config.testRoots ?? ['test', 'tests'].filter(directory => [...captured.keys()].some(path => path.startsWith(`${directory}/`))), sourceRoots: configSnapshot.config.sourceRoots ?? [] },
        read: path => { modules.storage.canonicalPath(path); return captured.get(path); },
        files: directory => [...captured.keys()].filter(path => path === directory || path.startsWith(`${directory}/`)),
        absolute: path => { modules.storage.canonicalPath(path); return join(root, path); },
        publish: () => { throw new TraceFormatError({ path: root, subject: 'read', message: 'Trace compilation cannot publish' }); },
      };
        const current = modules.trace.buildTrace(repo, 'off', { includeCode: false, annotationSourceMode: 'overlay' });
        const problems = current.findings.map(finding => ({ ...finding, subject: 'source' }));
        if (findings === undefined && (!current.complete || problems.length)) throw new TraceIncomplete({ findings: problems });
        findings?.push(...problems);
        const documentSources = repo.files('docs').filter(path => path.endsWith('.md')).map(path => [path, repo.read(path)!] as const);
        const nodes = current.documents.flatMap(record => { const node = decodeNode(record, current.documents, root); return node ? [node] : []; });
        const plans = deriveDesignPlans(nodes, documentSources, root);
        const allNodes = sorted([...nodes, ...plans], item => item.path);
        const memory: TraceMemory[] = current.documents.flatMap(record => record.metadata.kind === 'memory' ? [{ path: record.path, id: record.metadata.id, title: record.metadata.title, type: record.metadata.type, status: record.metadata.status, relations: record.metadata.relations, metadataDigest: digest(record.metadata) }] : []);
        const feedback: TraceFeedback[] = current.documents.flatMap(record => record.metadata.kind === 'issue' ? [{ path: record.path, id: record.metadata.id, title: record.metadata.title, status: record.metadata.status, ...(record.metadata.origin === undefined ? {} : { source: record.metadata.origin }), relations: record.metadata.relations, metadataDigest: digest(record.metadata) }] : []);
        const tests: TraceTest[] = current.annotations.cases.filter(test => test.status === 'active').map(test => ({ caseId: test.id, selector: test.id, path: test.file, title: test.name, suite: 'project', contract: test.contract, issues: test.issues }));
        const value = { generation, nodes: allNodes, pages: deriveFeaturePages(allNodes, documentSources), memory, feedback, tests };
        if (digest([...capture()]) !== digest([...captured])) throw new TraceInputChanged({ path: root, attempts: _attempt, changed: ['source snapshot'] });
        return { ...value, digest: digest(value) };
      });
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
  findings?: TraceFinding[],
): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const before = yield* readTraceConsistency(root, readTraceGeneration(root));
    const compiled = yield* Effect.result(compileTraceAtGeneration(root, before, attempt, findings));
    const after = yield* readTraceConsistency(root, readTraceGeneration(root));
    if (after !== before) {
      if (attempt < maximumStableReadAttempts) {
        yield* Effect.yieldNow;
        if (findings !== undefined) findings.length = 0;
        return yield* compileStableTrace(root, attempt + 1, findings);
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
        if (findings !== undefined) findings.length = 0;
        return yield* compileStableTrace(root, attempt + 1, findings);
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

export interface TraceCompileReport {
  readonly snapshot: TraceSnapshot;
  readonly complete: boolean;
  readonly findings: readonly TraceFinding[];
}
export const compileTraceReportUnderLease = Effect.fn("compileTraceReportUnderLease")(function*(root: string) {
  const findings: TraceFinding[] = [];
  const snapshot = yield* compileStableTrace(root, 1, findings);
  return { snapshot, complete: findings.length === 0, findings } satisfies TraceCompileReport;
});
export function compileTraceReport(root: string) {
  return withTraceReadLease(root, () => compileTraceReportUnderLease(root)).pipe(Effect.mapError(error => {
    if (!(error instanceof TraceMutationError)) return error;
    if (error.phase === "lock" && error.message.includes("busy")) return new TraceMutationActive({ path: error.path ?? root, attempts: 1 });
    return new TraceIoError({ operation: "read", path: error.path ?? root, message: error.message });
  }));
}
export function requireCompleteTraceUnderLease(root: string) {
  return compileTraceReportUnderLease(root).pipe(Effect.flatMap(report => report.complete ? compileTraceUnderLease(root) : Effect.fail(new TraceIncomplete({ findings: report.findings }))));
}

/** Require a complete relation graph while holding one read lease. */
export function requireCompleteTrace(root: string) {
  return withTraceReadLease(root, () => requireCompleteTraceUnderLease(root));
}
