import { repositoryRuntime } from '../../base/workspace/index.ts';
import { inspectStatechart, makeDocumentProjectionCache, outsideStatechartOutputs, statechartOutputRoots } from '../documents/index.ts';
import type { TraceEdge } from "../../model/index.ts";


import { scanAnnotations } from "../tests/index.ts";
import { scanCode } from "../code/index.ts";
import type { CodeDeclaration } from "../../model/index.ts";
import { checkDocuments, diagnoseDocuments, inspectDocumentRecords, type DocumentInventory } from "../documents/index.ts";
import { ConcordError, statechartBlocks, type AnnotatedCase, type Finding, type Repository } from "../../model/index.ts";
import { TASTE_PATH, inspectTaste } from "../taste/index.ts";
import { measureScan, measureScanAsync, type ScanTiming } from "../../base/sources/index.ts";
import { referenceResolver } from "../documents/index.ts";
import { resolveCommit } from "../../base/git/index.ts";
import { extractSteps } from "../documents/index.ts";
interface TraceOptions {
  readonly includeCode?: boolean;
  readonly includeStatecharts?: boolean;
  readonly inventory?: DocumentInventory;
  readonly timing?: ScanTiming;
  readonly annotationSourceMode?: 'overlay';
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
export async function buildTrace(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use', options: TraceOptions = {}) {
  const read = async () => (await buildUnderSnapshot(repo, cache, options)).trace;
  return repo.snapshot === undefined ? (await read()) : repo.snapshot(read);
}
// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
// @concord-implements docs/feature/local-sdlc/architecture.md#完整性诊断
export async function buildUnderSnapshot(repo: Repository, cache: 'use' | 'off' | 'rebuild', options: TraceOptions) {
  const runtime = repositoryRuntime(repo);
  const contentCache = makeDocumentProjectionCache(runtime);
  try {
  const inventory = options.inventory ?? diagnoseDocuments(repo);
  const documents = inventory.documents;
  const annotations = (await measureScanAsync(options.timing, 'trace.annotations', async () => (await scanAnnotations(repo, { cache, sourceMode: options.annotationSourceMode }))));
  // Steps and taste links share one read of each docs page.
  const pages = new Map<string, { readonly source?: string; readonly cause?: unknown }>();
  const readPage = (path: string): string | undefined => {
    if (!pages.has(path)) { try { pages.set(path, { source: repo.read(path) }); } catch (cause) { pages.set(path, { cause }); } }
    const page = pages.get(path)!;
    if (page.cause !== undefined) throw page.cause;
    return page.source;
  };
  const docs = repo.files('docs');
  const outputs = statechartOutputRoots(repo, docs);
  const docPaths = docs.filter(path => path.endsWith('.md') && outsideStatechartOutputs(path, outputs));
  const markdown: { path: string; source: string }[] = [];
  for (const path of docPaths) {
    try { const source = readPage(path); if (source !== undefined) markdown.push({ path, source }); }
    catch { /* The normal diagnostic pass below retains each read failure. */ }
  }
  const statechartFindings: (Finding & { readonly category: 'relation' })[] = [];
  if (options.includeStatecharts) for (const { path, source } of markdown) {
    if (path.startsWith('docs/_template/')) continue;
    for (const block of statechartBlocks(path, source)) {
      for (const finding of inspectStatechart(repo, block).findings) statechartFindings.push({ ...finding, category: 'relation' });
    }
  }
  // Managed owners and supporting pages share one bounded memory-cache batch.
  // This also covers root pages and templates outside the owner inventory.
  inspectDocumentRecords(markdown, true, runtime, contentCache);
  const taste = measureScan(options.timing, 'trace.taste', () => inspectTaste(repo, readPage));
  const tasteFindings = taste.findings;
  const advisories = tasteFindings.filter((finding) => finding.code === 'TasteMissing');
  const findings: Finding[] = [...inventory.findings, ...measureScan(options.timing, 'trace.documents', () => checkDocuments(repo, documents, outputs)), ...annotations.findings, ...tasteFindings.filter((finding) => finding.code !== 'TasteMissing')];
  // Taste list IDs are paragraphs, not Use Case steps.
  for (const path of docPaths.filter(path => path !== TASTE_PATH)) {
    try { const source = readPage(path); if (source !== undefined) findings.push(...extractSteps(path, source, runtime, contentCache).findings); }
    catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidSteps', path, message: cause instanceof Error ? cause.message : String(cause) }); }
  }
  if (!inventory.complete && inventory.findings.length === 0) findings.push({ code: 'IncompleteInventory', path: '.', message: 'Document inventory is incomplete; no complete-graph conclusion is available' });
  const edges: TraceEdge[] = [];
  const references = referenceResolver(repo, documents);
  for (const doc of documents) {
    const m = doc.metadata;
    const add = (to: string, relation: string) => edges.push({ from: doc.path, to, relation });
    switch (m.kind) {
      case 'use-case': add(m.feature, 'feature'); break;
      case 'roadmap': if (m.adoptedAs) add(m.adoptedAs, 'adopted-as'); break;
      case 'design': break;
      case 'memory': for (const relation of m.relations) add(relation.target, relation.role); break;
      case 'issue': {
        for (const relation of m.relations) add(relation.target, relation.role);
        break;
      }
    }
  }
  const tasteEdges = new Set<string>();
  for (const reference of taste.references) {
    const to = `${TASTE_PATH}#${reference.target}`;
    if (tasteEdges.has(`${reference.path}\0${to}`)) continue;
    tasteEdges.add(`${reference.path}\0${to}`);
    edges.push({ from: reference.path, to, relation: 'taste' });
  }
  for (const item of annotations.cases) {
    const source = `case:${item.id}`;
    for (const [target, relation] of [[item.contract, 'contract'], ...item.issues.map(r => [r, 'issue'])] as const) {
      if (target === undefined || relation === undefined) continue;
      try {
        const owner = references.resolve(target, relation === 'contract' ? ['feature', 'use-case', 'engineering'] : ['issue']);
        if (relation === 'contract' && (item.contractKind === 'feature' ? !['feature', 'engineering'].includes(owner.metadata.kind) : owner.metadata.kind !== 'use-case')) throw new ConcordError('ContractKindMismatch', `@${item.contractKind} must point to a ${item.contractKind} contract`);
        if (item.status === 'active') edges.push({ from: source, to: target, relation });
      } catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path: item.file, line: item.line, message: cause instanceof Error ? cause.message : String(cause) }); }
    }
  }
  // Implementation associations are independent of test declarations and fixed evidence.
  const code = options.includeCode === false ? undefined : (await measureScanAsync(options.timing, 'trace.code', async () => (await scanCode(repo, { cache, timing: options.timing }))));
  const codeDeclarations: readonly CodeDeclaration[] = code?.codes ?? [];
  findings.push(...(code?.findings ?? []));
  for (const item of codeDeclarations) for (const target of item.contracts) {
    try {
      references.resolve(target, ['feature', 'use-case', 'engineering']);
      edges.push({ from: `code:${item.id}`, to: target, relation: 'implements' });
    } catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path: item.file, line: item.line, message: cause instanceof Error ? cause.message : String(cause) }); }
  }
  findings.push(...measureScan(options.timing, 'trace.verifyReferences', () => references.verify()));
  const trace = { documents, annotations, tasteReferences: taste.references, codeDeclarations, codeFiles: code?.files ?? [], edges, findings,
    ...(options.includeStatecharts ? { statechartFindings } : {}),
    complete: inventory.complete && findings.every(finding => finding.code === 'UnknownPageKind'), inventoryComplete: inventory.complete, advisories, codeCache: code?.cache, codeRelationsUnknown: code?.relationsUnknown ?? false };
  return { trace, references };
  } finally { contentCache.close(); }
}
export function requireValidTrace(trace: Awaited<ReturnType<typeof buildTrace>>): void {
  if (!trace.complete || trace.findings.length) throw new ConcordError('TraceInvalid', 'Fix the reported source or contract findings before continuing', trace.findings);
}

export type RelationshipKind = 'code' | 'test';
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#list
export function selectCase(cases: readonly AnnotatedCase[], id: string): AnnotatedCase {
  const matches = cases.filter(c => c.id === id);
  if (matches.length !== 1) throw new ConcordError(matches.length ? 'CaseAmbiguous' : 'CaseNotFound', `Expected one case for ${id}, found ${matches.length}`);
  return matches[0]!;
}
// @concord-end
