import { analysisView, type AnalysisView } from './analysis-view.js';
import { scanAnnotations } from './annotations.js';
import { scanCode, type CodeDeclaration } from './code.js';
import { checkDocuments, diagnoseDocuments, findDocument, type DocumentInventory } from './documents.js';
import { inspectResolutionEvidence } from './evidence.js';
import { ConcordError, type AnnotatedCase, type DocumentRecord, type Finding, type Repository } from './shared.js';
import { checkConstitution, showConstitution } from './constitution.js';
import { measureScan, type ScanTiming } from './scan-timing.js';
import { referenceResolver } from './refs.js';
import { extractSteps } from './steps.js';

export interface TraceEdge { readonly from: string; readonly to: string; readonly relation: string }
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
export function buildTrace(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use', options: { includeCode?: boolean; inventory?: DocumentInventory; timing?: ScanTiming } = {}) {
  const read = () => buildUnderSnapshot(repo, cache, options).trace;
  return repo.snapshot === undefined ? read() : repo.snapshot(read);
}
// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
// @concord-implements docs/feature/local-sdlc/architecture.md#完整性诊断
function buildUnderSnapshot(repo: Repository, cache: 'use' | 'off' | 'rebuild', options: { includeCode?: boolean; inventory?: DocumentInventory; timing?: ScanTiming }) {
  const inventory = options.inventory ?? diagnoseDocuments(repo);
  const documents = inventory.documents;
  const annotations = measureScan(options.timing, 'trace.annotations', () => scanAnnotations(repo, { cache }));
  const constitutionFindings = measureScan(options.timing, 'trace.constitution', () => checkConstitution(repo));
  const advisories = constitutionFindings.filter((finding) => finding.code === 'ConstitutionDraft');
  const findings: Finding[] = [...inventory.findings, ...measureScan(options.timing, 'trace.documents', () => checkDocuments(repo, documents)), ...annotations.findings, ...constitutionFindings.filter((finding) => finding.code !== 'ConstitutionDraft')];
  for (const path of repo.files('docs').filter(path => path.endsWith('.md'))) {
    try { const source = repo.read(path); if (source !== undefined) findings.push(...extractSteps(path, source).findings); }
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
      case 'feature': if (m.origin) add(m.origin, 'origin'); break;
      case 'roadmap': if (m.adoptedAs) add(m.adoptedAs, 'adopted-as'); break;
      case 'design': for (const ref of m.decision?.targets ?? []) add(ref, 'decides'); break;
      case 'memory': for (const ref of m.promotions) add(ref, 'promotion'); if (m.supersededBy) add(m.supersededBy, 'superseded-by'); break;
      case 'issue': {
        for (const relation of m.memoryRelations) add(relation.memory, `memory:${relation.kind}`);
        for (const ref of m.adoptions.current) add(ref, 'adoption');
        const closure = m.closure;
        if (closure !== undefined && 'memory' in closure) add(closure.memory, `closure:${closure.kind}`);
        if (closure?.kind === 'delivered') add(closure.target, 'closure:delivered-target');
        if (closure?.kind === 'duplicate') add(closure.canonical, 'closure:duplicate');
        break;
      }
    }
    if (m.kind === 'feature' || m.kind === 'design') for (const ref of m.constitutionRefs ?? []) add(ref, 'constitution');
  }
  for (const item of annotations.cases) {
    const source = `case:${item.id}`;
    for (const [target, relation] of [[item.contract, 'contract'], ...item.regressions.map(r => [r, 'regression'])] as const) {
      if (target === undefined || relation === undefined) continue;
      try {
        const owner = references.resolve(target, relation === 'contract' ? ['feature', 'use-case'] : ['memory']);
        if (relation === 'contract' && owner.metadata.kind !== item.contractKind) throw new ConcordError('ContractKindMismatch', `@${item.contractKind} must point to a ${item.contractKind} contract`);
        if (relation === 'regression' && (owner.metadata.kind !== 'memory' || owner.metadata.memoryKind !== 'problem')) throw new ConcordError('InvalidRegression', 'Regression targets must be Problem Memory');
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
  const memories = documents.flatMap(doc => doc.metadata.kind === 'memory' && doc.metadata.resolution !== undefined
    ? [{ path: doc.path, evidenceLevel: doc.metadata.resolution.evidenceLevel, evidence: inspectResolutionEvidence(repo, doc.metadata.resolution) }]
    : []);
  const trace = { documents, annotations, codeDeclarations, codeFiles: code?.files ?? [], edges, findings, complete: inventory.complete && findings.length === 0, inventoryComplete: inventory.complete, advisories, memories, codeCache: code?.cache, codeRelationsUnknown: code?.relationsUnknown ?? false };
  return { trace, references };
}
/** Derivation and its temporary resolver share the graph's source snapshot. */
function deriveTrace<A>(repo: Repository, cache: 'use' | 'off', strict: boolean, derive: (trace: ReturnType<typeof buildTrace>, references: ReturnType<typeof referenceResolver>) => A): A {
  const read = () => {
    const { trace, references } = buildUnderSnapshot(repo, cache, {});
    if (strict) requireValidTrace(trace);
    const result = derive(trace, references);
    const rechecked = references.verify();
    trace.findings.push(...rechecked.filter(finding => !trace.findings.some(previous => previous.code === finding.code && previous.path === finding.path && previous.message === finding.message)));
    trace.complete = trace.complete && trace.findings.length === 0;
    if (strict) requireValidTrace(trace);
    return result;
  };
  return repo.snapshot === undefined ? read() : repo.snapshot(read);
}
export function requireValidTrace(trace: ReturnType<typeof buildTrace>): void {
  if (!trace.complete || trace.findings.length) throw new ConcordError('TraceInvalid', 'Fix the reported source or contract findings before continuing', trace.findings);
}
// @concord-end
const pathOf = (ref: string) => ref.split('#')[0]!;
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#show
function belongsTo(references: ReturnType<typeof referenceResolver>, trace: ReturnType<typeof buildTrace>, selectedPaths: ReadonlySet<string>, ref: string): boolean {
  try {
    const owner = references.resolve(ref);
    return selectedPaths.has(owner.path) || (owner.metadata.kind === 'use-case' && selectedPaths.has(owner.metadata.feature));
  } catch (cause) {
    // Findings retain missing/malformed endpoints. Partial displays must not
    // turn one unresolved edge into a failure to inspect a healthy subject.
    if (!trace.complete && cause instanceof ConcordError && ['ReferenceNotFound', 'InvalidReferenceTarget', 'AnchorNotFound', 'InvalidReference', 'InvalidData', 'ResearchMigrationRequired'].includes(cause.code)) return false;
    throw cause;
  }
}
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#show
export function traceShow(repo: Repository, selector: string, cache: 'use' | 'off' = 'use') {
  return deriveTrace(repo, cache, true, (trace, references) => traceShowValue(repo, trace, references, selector));
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#show
export function traceShowValue(repo: Repository, trace: ReturnType<typeof buildTrace>, references: ReturnType<typeof referenceResolver>, selector: string) {
    const document = findDocument(trace.documents, selector);
    const relatedPaths = new Set([document.path]);
    if (document.metadata.kind === 'feature') for (const doc of trace.documents) if (doc.metadata.kind === 'use-case' && pathOf(doc.metadata.feature) === document.path) relatedPaths.add(doc.path);
    const incoming = trace.edges.filter(e => e.relation !== 'constitution' && belongsTo(references, trace, relatedPaths, e.to));
    for (const edge of incoming) relatedPaths.add(pathOf(edge.to));
    const outgoing = trace.edges.filter(e => relatedPaths.has(e.from));
    const ids = new Set(incoming.filter(e => e.from.startsWith('case:')).map(e => e.from.slice(5)));
    const codeIds = new Set(incoming.filter(e => e.from.startsWith('code:')).map(e => e.from.slice(5)));
    const codeDeclarations = trace.codeDeclarations.filter(c => codeIds.has(c.id)).map(c => ({ ...c, matchedContracts: c.contracts.filter(ref => belongsTo(references, trace, relatedPaths, ref)) }));
    const analysis = analysisView(repo, trace.annotations.cases.filter(c => ids.has(c.id)), trace.codeDeclarations, trace.documents, references);
    return { operation: 'trace-show', subject: document, relatedPaths: [...relatedPaths], incoming, outgoing, tests: trace.annotations.cases.filter(c => ids.has(c.id)), codeDeclarations, stepGroups: trace.documents.filter(doc => doc.metadata.kind === 'use-case' && relatedPaths.has(doc.path)).map(doc => stepGroups(repo, trace, doc, analysis)), cache: trace.annotations.cache, analysis };
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#步骤分组输出
export function stepGroups(repo: Repository, trace: ReturnType<typeof buildTrace>, document: DocumentRecord, analysis: AnalysisView = analysisView(repo, trace.annotations.cases, trace.codeDeclarations, trace.documents)) {
  const extracted = extractSteps(document.path, repo.read(document.path)!);
  const group = (ref: string) => {
    const tests = trace.annotations.cases.filter(item => item.status === 'active' && item.contract === ref);
    const ids = new Set(tests.map(test => test.id));
    return { ref, tests, codeDeclarations: trace.codeDeclarations.filter(item => item.contracts.includes(ref)), relevance: analysis.relevance.filter(item => ids.has(item.testId)) };
  };
  const steps = extracted.steps.map(step => {
    const relationships = group(`${document.path}#${step.id}`);
    return { ...step, ...relationships, testCount: relationships.tests.length, codeCount: relationships.codeDeclarations.length };
  });
  const ids = new Set(steps.map(step => step.ref));
  const other = [...new Set(trace.edges.map(edge => edge.to).filter(ref => ref.startsWith(`${document.path}#`) && !ids.has(ref)))];
  const wholeUseCase = group(document.path), nonStepAnchors = other.map(group);
  const relevance = [...steps, wholeUseCase, ...nonStepAnchors].flatMap(group => group.relevance);
  const result = relevance.some(item => item.relevance.verdict === 'observed') ? 'observed' as const : 'not-observed' as const;
  const gaps = [...new Set(relevance.flatMap(item => item.relevance.gaps))].sort();
  return { path: document.path, steps, lists: extracted.lists, wholeUseCase, nonStepAnchors, unassociatedSteps: steps.filter(step => step.tests.length === 0 && step.codeDeclarations.length === 0).map(step => step.ref), observation: { result, gaps: relevance.length ? gaps : ['NoAnalyzer'] } };
}

type RelationshipKind = 'code' | 'test';

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md#list-gaps
export function traceGaps(repo: Repository, cache: 'use' | 'off' = 'use') {
  return deriveTrace(repo, cache, true, (trace, references) => traceGapsValue(repo, trace, references));
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md#list-gaps
export function traceGapsValue(repo: Repository, trace: ReturnType<typeof buildTrace>, references: ReturnType<typeof referenceResolver>) {
    const ownerCounts = new Map<string, { code: number; test: number }>();
    const pageCounts = new Map<string, { code: number; test: number }>();
    const increment = (counts: Map<string, { code: number; test: number }>, path: string, kind: RelationshipKind) => {
      const value = counts.get(path) ?? { code: 0, test: 0 };
      value[kind]++;
      counts.set(path, value);
    };
    for (const edge of trace.edges) {
      const kind = edge.relation === 'implements' ? 'code' : edge.relation === 'contract' ? 'test' : undefined;
      if (kind === undefined) continue;
      const owner = references.resolve(edge.to);
      increment(ownerCounts, owner.path, kind);
      if (owner.metadata.kind === 'use-case' && owner.metadata.feature !== owner.path) increment(ownerCounts, owner.metadata.feature, kind);
      increment(pageCounts, pathOf(edge.to), kind);
    }
    const gap = (counts: { readonly code: number; readonly test: number }): readonly RelationshipKind[] => [
      ...(counts.code === 0 ? ['code' as const] : []),
      ...(counts.test === 0 ? ['test' as const] : []),
    ];
    const contracts = trace.documents.flatMap(document => {
      if (document.metadata.kind !== 'feature' && document.metadata.kind !== 'use-case') return [];
      const counts = ownerCounts.get(document.path) ?? { code: 0, test: 0 };
      const missing = gap(counts);
      return missing.length === 0 ? [] : [{ path: document.path, kind: document.metadata.kind, title: document.metadata.title, missing, relationships: counts }];
    });
    const cliPages = trace.documents.flatMap(document => {
      if (document.metadata.kind !== 'feature') return [];
      const path = document.path.replace(/\/README\.md$/u, '/cli.md');
      if (path === document.path || repo.read(path) === undefined) return [];
      const counts = pageCounts.get(path) ?? { code: 0, test: 0 };
      const missing = gap(counts);
      return missing.length === 0 ? [] : [{ path, feature: document.path, title: document.metadata.title, missing, relationships: counts }];
    });
    return {
      operation: 'trace-gaps',
      semantics: 'missing-explicit-relationships-not-coverage',
      limitations: ['Only documented CLI pages are discoverable; undocumented commands require a product-owned inventory.'],
      contracts,
      cliPages,
      unmarkedLists: trace.documents.filter(doc => doc.metadata.kind === 'use-case').flatMap(doc => {
        const lists = extractSteps(doc.path, repo.read(doc.path)!).lists.filter(list => list.marked < list.items);
        return lists.length ? [{ path: doc.path, lists }] : [];
      }),
      cache: trace.annotations.cache,
      codeCache: trace.codeCache,
    };
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#show
export function documentShow(repo: Repository, selector: string, kind: DocumentRecord['metadata']['kind'], cache: 'use' | 'off' = 'use') {
  const { trace, document, useCases, relatedPaths, incoming, testIds, codeIds } = deriveTrace(repo, cache, false, (trace, references) => {
    const document = findDocument(trace.documents, selector, kind);
    const useCases = kind === 'feature' ? trace.documents.filter(candidate => candidate.metadata.kind === 'use-case' && pathOf(candidate.metadata.feature) === document.path) : [];
    const relatedPaths = new Set([document.path, ...useCases.map(candidate => candidate.path)]);
    const incoming = trace.edges.filter(edge => edge.relation !== 'constitution' && belongsTo(references, trace, relatedPaths, edge.to));
    const testIds = new Set(incoming.filter(edge => edge.from.startsWith('case:')).map(edge => edge.from.slice(5)));
    const codeIds = new Set(incoming.filter(edge => edge.from.startsWith('code:')).map(edge => edge.from.slice(5)));
    return { trace, document, useCases, relatedPaths, incoming, testIds, codeIds };
  });
  return {
    operation: `${kind}-show`,
    document: { path: document.path, metadata: document.metadata, digest: document.digest },
    ...(kind === 'feature' ? { useCases: useCases.map(candidate => ({ path: candidate.path, metadata: candidate.metadata, digest: candidate.digest })) } : {}),
    incoming,
    outgoing: trace.edges.filter(edge => relatedPaths.has(edge.from)),
    tests: trace.annotations.cases.filter(testCase => testIds.has(testCase.id)),
    codeDeclarations: trace.codeDeclarations.filter(declaration => codeIds.has(declaration.id)),
    complete: trace.complete,
    findings: trace.findings,
  };
}
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#list
export function selectCase(cases: readonly AnnotatedCase[], id: string): AnnotatedCase {
  const matches = cases.filter(c => c.id === id);
  if (matches.length !== 1) throw new ConcordError(matches.length ? 'CaseAmbiguous' : 'CaseNotFound', `Expected one case for ${id}, found ${matches.length}`);
  return matches[0]!;
}
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#render
export function renderReview(repo: Repository, selector: string | undefined, cache: 'use' | 'off' = 'use'): string {
  return deriveTrace(repo, cache, true, (trace, references) => renderReviewValue(repo, trace, references, selector).segments.map(segment => 'text' in segment ? segment.text : showConstitution(repo).body.trimEnd()).join(''));
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#render
export function renderReviewValue(repo: Repository, trace: ReturnType<typeof buildTrace>, references: ReturnType<typeof referenceResolver>, selector: string | undefined) {
    const docs: readonly DocumentRecord[] = selector ? [findDocument(trace.documents, selector)] : trace.documents;
    const selectedPaths = new Set(docs.map(d => d.path));
    const cases = selector ? trace.annotations.cases.filter(c => belongsTo(references, trace, selectedPaths, c.contract) || c.regressions.some(r => belongsTo(references, trace, selectedPaths, r))) : trace.annotations.cases;
    const codes = selector ? trace.codeDeclarations.filter(c => c.contracts.some(ref => belongsTo(references, trace, selectedPaths, ref))) : trace.codeDeclarations;
    const segments: ({ text: string } | { constitution: { path: string; digest: string } })[] = [];
    const lines = ['# Concord review', '', 'This is local review material. Code declarations describe implementation associations, not completion or test coverage. Test annotations describe ownership; command evidence does not prove native case coverage.', '', '## Constitution', ''];
    if (repo.config.constitution === undefined) lines.push('- Not configured. Existing projects must opt in with `concord constitution initialize`.');
    else {
      const constitution = showConstitution(repo);
      lines.push(`- ${constitution.metadata.status}, digest ${constitution.digest}. Structural validity is not semantic compliance.`, '');
      segments.push({ text: `${lines.join('\n')}\n` }, { constitution: { path: constitution.path, digest: constitution.digest } });
      lines.length = 0;
      lines.push('');
      for (const document of docs) if (document.metadata.kind === 'feature' || document.metadata.kind === 'design') {
        for (const reference of document.metadata.constitutionRefs ?? []) lines.push(`- Applicable to [${document.metadata.title}](${document.path}): [${reference}](${reference})`);
      }
    }
    lines.push('', '## Contracts and decisions', '');
    for (const d of docs.filter(d => d.metadata.kind !== 'memory' && d.metadata.kind !== 'issue')) lines.push(`- [${d.metadata.title}](${d.path}) — ${d.metadata.kind}`);
    lines.push('', '## Code declarations', '');
    for (const c of codes) lines.push(`- **${c.symbol ?? `${c.file}:${c.line}–${c.endLine}`}** — [${c.file}:${c.line}–${c.endLine}](${c.file}#L${c.line}); ${c.scope}`, ...c.contracts.map(ref => `  - Implements: [${ref}](${ref})`));
    lines.push('', '## Test declarations', '');
    for (const c of cases) lines.push(`- **${c.id}** — [${c.file}:${c.line}](${c.file}#L${c.line}); ${c.status}${c.skipped ? ', skipped/todo' : ''}; contract: [${c.contract}](${c.contract})`, ...c.regressions.map(r => `  - Regression: [${r}](${r})`));
    const analysis = analysisView(repo, cases, trace.codeDeclarations, trace.documents, references);
    for (const doc of trace.documents.filter(doc => doc.metadata.kind === 'use-case' && (!selector || selectedPaths.has(doc.path) || doc.metadata.kind === 'use-case' && selectedPaths.has(doc.metadata.feature)))) {
      const groups = stepGroups(repo, trace, doc, analysis);
      lines.push(`## Use Case steps: ${doc.path}`, '', 'Declarations are associations, not execution or coverage. Dependency observations below describe this review snapshot.', '');
      for (const group of [...groups.steps, groups.wholeUseCase, ...groups.nonStepAnchors]) {
        const label = group.ref === doc.path ? 'Whole Use Case' : groups.nonStepAnchors.includes(group) ? 'Non-step anchor' : 'Step';
        lines.push(`### ${label}: ${group.ref}`, ...group.tests.map(item => `- Test: ${item.id} (${item.file}:${item.line})`), ...group.codeDeclarations.map(item => `- Code: ${item.id} (${item.file}:${item.line})`));
        for (const item of group.relevance) lines.push(`- Dependency intersection for ${item.testId}: ${item.message}; scope=${item.scope}; gaps=${item.relevance.gaps.join(', ')}`);
        if (!group.tests.length && !group.codeDeclarations.length) lines.push('- No associated declarations.');
        lines.push('');
      }
    }
    lines.push('', '## Engineering memory', '');
    const memoryPaths = new Set(cases.flatMap(c => c.regressions.map(pathOf)));
    for (const d of trace.documents) if (d.metadata.kind === 'memory' && (!selector || selectedPaths.has(d.path) || memoryPaths.has(d.path))) {
      const m = d.metadata;
      lines.push(`- [${m.title}](${d.path}) — ${m.memoryKind}, ${m.state}, epoch ${m.epoch}`);
      if (m.resolution) lines.push(`  - Resolution: ${m.resolution.kind}; evidence level: ${m.resolution.evidenceLevel}; ${m.resolution.reason}`, `  - Historical evidence availability: ${JSON.stringify(inspectResolutionEvidence(repo, m.resolution))}`);
    }
    lines.push('', '## Local feedback and observations', '');
    for (const d of docs) if (d.metadata.kind === 'issue') lines.push(`- [${d.metadata.title}](${d.path}) — ${d.metadata.state} (local document; Concord never mutates the remote provider)`);
    segments.push({ text: `${lines.join('\n')}\n` });
    return { segments };
}

/** Separates edit drift from diagnostics that still invalidate the query. */
// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export function siftQueryDrift(trace: ReturnType<typeof buildTrace>) {
  const drift = trace.findings.filter(finding => finding.code === 'SourceChanged' || finding.code === 'CodeSourceChanged');
  const unknown: 'code'[] = trace.codeRelationsUnknown ? ['code'] : [];
  trace.findings = trace.findings.filter(finding => !drift.includes(finding));
  // Only drift can explain an incomplete trace here; other incompleteness is retained.
  if (drift.length > 0) trace.complete = trace.inventoryComplete && trace.findings.length === 0;
  return { files: drift.map(finding => finding.path), unknown };
}

/** Called inside observeProjection: nested source snapshots never verify the outer observation. */
export function scanQueryValue(repo: Repository, query: readonly string[]) {
  const { trace, references } = buildUnderSnapshot(repo, 'off', {});
  const initial = siftQueryDrift(trace);
  requireValidTrace(trace);
  const value = query[0] === 'review' ? renderReviewValue(repo, trace, references, query[2])
    : query[1] === 'show' ? traceShowValue(repo, trace, references, query[2]!) : traceGapsValue(repo, trace, references);
  trace.findings.push(...references.verify());
  const final = siftQueryDrift(trace);
  requireValidTrace(trace);
  return { value, complete: trace.complete, files: [...initial.files, ...final.files], unknown: [...new Set([...initial.unknown, ...final.unknown])] };
}
// @concord-end
