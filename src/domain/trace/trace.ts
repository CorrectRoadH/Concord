import type { TraceEdge } from "../../model/index.js";


import { scanAnnotations } from "../tests/index.js";
import { scanCode } from "../code/index.js";
import type { CodeDeclaration } from "../../model/index.js";
import { checkDocuments, diagnoseDocuments, type DocumentInventory } from "../documents/index.js";
import { ConcordError, type AnnotatedCase, type Finding, type Repository } from "../../model/index.js";
import { CONSTITUTION_PATH, inspectConstitution } from "../constitution/index.js";
import { measureScan, type ScanTiming } from "../../base/sources/index.js";
import { referenceResolver } from "../documents/index.js";
import { resolveCommit } from "../../base/git/index.js";
import { extractSteps } from "../documents/index.js";
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
export function buildTrace(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use', options: { includeCode?: boolean; inventory?: DocumentInventory; timing?: ScanTiming; annotationSourceMode?: 'overlay' } = {}) {
  const read = () => buildUnderSnapshot(repo, cache, options).trace;
  return repo.snapshot === undefined ? read() : repo.snapshot(read);
}
// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
// @concord-implements docs/feature/local-sdlc/architecture.md#完整性诊断
export function buildUnderSnapshot(repo: Repository, cache: 'use' | 'off' | 'rebuild', options: { includeCode?: boolean; inventory?: DocumentInventory; timing?: ScanTiming; annotationSourceMode?: 'overlay' }) {
  const inventory = options.inventory ?? diagnoseDocuments(repo);
  const documents = inventory.documents;
  const annotations = measureScan(options.timing, 'trace.annotations', () => scanAnnotations(repo, { cache, sourceMode: options.annotationSourceMode }));
  // Steps and constitution links share one read of each docs page.
  const pages = new Map<string, { readonly source?: string; readonly cause?: unknown }>();
  const readPage = (path: string): string | undefined => {
    if (!pages.has(path)) { try { pages.set(path, { source: repo.read(path) }); } catch (cause) { pages.set(path, { cause }); } }
    const page = pages.get(path)!;
    if (page.cause !== undefined) throw page.cause;
    return page.source;
  };
  const constitution = measureScan(options.timing, 'trace.constitution', () => inspectConstitution(repo, readPage));
  const constitutionFindings = constitution.findings;
  const advisories = constitutionFindings.filter((finding) => finding.code === 'ConstitutionDraft');
  const findings: Finding[] = [...inventory.findings, ...measureScan(options.timing, 'trace.documents', () => checkDocuments(repo, documents)), ...annotations.findings, ...constitutionFindings.filter((finding) => finding.code !== 'ConstitutionDraft')];
  // Constitution list IDs are paragraphs, not Use Case steps.
  for (const path of repo.files('docs').filter(path => path.endsWith('.md') && path !== CONSTITUTION_PATH)) {
    try { const source = readPage(path); if (source !== undefined) findings.push(...extractSteps(path, source).findings); }
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
      case 'design': for (const ref of m.decision?.targets ?? []) add(ref, 'decides'); break;
      case 'memory': for (const relation of m.relations) add(relation.target, relation.role); if (m.supersededBy) add(m.supersededBy, 'superseded-by'); break;
      case 'issue': {
        for (const relation of m.relations) add(relation.target, relation.role);
        const closure = m.closure;
        if (closure !== undefined && 'memory' in closure) add(closure.memory, `closure:${closure.kind}`);
        if (closure?.kind === 'delivered') add(closure.target, 'closure:delivered-target');
        if (closure?.kind === 'duplicate') add(closure.canonical, 'closure:duplicate');
        break;
      }
    }
  }
  const constitutionEdges = new Set<string>();
  for (const reference of constitution.references) {
    const to = `${CONSTITUTION_PATH}#${reference.target}`;
    if (constitutionEdges.has(`${reference.path}\0${to}`)) continue;
    constitutionEdges.add(`${reference.path}\0${to}`);
    edges.push({ from: reference.path, to, relation: 'constitution' });
  }
  for (const item of annotations.cases) {
    const source = `case:${item.id}`;
    for (const [target, relation] of [[item.contract, 'contract'], ...item.issues.map(r => [r, 'issue'])] as const) {
      if (target === undefined || relation === undefined) continue;
      try {
        const owner = references.resolve(target, relation === 'contract' ? ['feature', 'use-case'] : ['issue']);
        if (relation === 'contract' && owner.metadata.kind !== item.contractKind) throw new ConcordError('ContractKindMismatch', `@${item.contractKind} must point to a ${item.contractKind} contract`);
        if (item.status === 'active') edges.push({ from: source, to: target, relation });
      } catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path: item.file, line: item.line, message: cause instanceof Error ? cause.message : String(cause) }); }
    }
  }
  // Implementation associations are independent of test declarations and fixed evidence.
  const code = options.includeCode === false ? undefined : measureScan(options.timing, 'trace.code', () => scanCode(repo, { cache, timing: options.timing }));
  const codeDeclarations: readonly CodeDeclaration[] = code?.codes ?? [];
  findings.push(...(code?.findings ?? []));
  for (const item of codeDeclarations) for (const target of item.contracts) {
    try {
      references.resolve(target, ['feature', 'use-case', 'engineering']);
      edges.push({ from: `code:${item.id}`, to: target, relation: 'implements' });
    } catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path: item.file, line: item.line, message: cause instanceof Error ? cause.message : String(cause) }); }
  }
  findings.push(...measureScan(options.timing, 'trace.verifyReferences', () => references.verify()));
  for (const document of documents) if (document.metadata.kind === 'issue' && document.metadata.closure?.kind === 'fixed' && document.metadata.closure.verification) {
    const verification = document.metadata.closure.verification;
    try {
      resolveCommit(repo.root, verification.defect); resolveCommit(repo.root, verification.fix);
      for (const id of verification.tests) if (!annotations.cases.some(test => test.id === id && test.status === 'active' && test.issues.includes(document.path))) throw new ConcordError('FixUnverifiable', `Recorded test ${id} no longer has an @issue relation to ${document.path}`);
    } catch (cause) { findings.push({ code: 'FixUnverifiable', path: document.path, message: cause instanceof Error ? cause.message : String(cause) }); }
  }
  const verifications = documents.flatMap(doc => doc.metadata.kind === 'issue' && doc.metadata.closure?.kind === 'fixed' && doc.metadata.closure.verification ? [{ path: doc.path, verified: 'recorded' as const, verification: doc.metadata.closure.verification }] : []);
  const trace = { documents, annotations, constitutionReferences: constitution.references, codeDeclarations, codeFiles: code?.files ?? [], edges, findings, complete: inventory.complete && findings.length === 0, inventoryComplete: inventory.complete, advisories, verifications, codeCache: code?.cache, codeRelationsUnknown: code?.relationsUnknown ?? false };
  return { trace, references };
}
export function requireValidTrace(trace: ReturnType<typeof buildTrace>): void {
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
