// @concord-file derived-trace-and-review
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { scanAnnotations } from './annotations.js';
import { scanCode, type CodeDeclaration } from './code.js';
import { checkDocuments, findDocument, loadDocuments, resolveReference } from './documents.js';
import { inspectResolutionEvidence } from './evidence.js';
import { ConcordError, type AnnotatedCase, type DocumentRecord, type Finding, type Repository } from './shared.js';

export interface TraceEdge { readonly from: string; readonly to: string; readonly relation: string }
// @concord-code compile-current-trace
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md
export function buildTrace(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use', options: { includeCode?: boolean } = {}) {
  const documents = loadDocuments(repo);
  const annotations = scanAnnotations(repo, { cache });
  const findings: Finding[] = [...checkDocuments(repo, documents), ...annotations.findings];
  const edges: TraceEdge[] = [];
  for (const doc of documents) {
    const m = doc.metadata;
    const add = (to: string, relation: string) => edges.push({ from: doc.path, to, relation });
    switch (m.kind) {
      case 'use-case': add(m.feature, 'feature'); break;
      case 'feature': if (m.origin) add(m.origin, 'origin'); break;
      case 'roadmap': if (m.adoptedAs) add(m.adoptedAs, 'adopted-as'); break;
      case 'design': for (const ref of m.decision?.targets ?? []) add(ref, 'decides'); break;
      case 'memory': for (const ref of m.promotions) add(ref, 'promotion'); if (m.supersededBy) add(m.supersededBy, 'superseded-by'); break;
      case 'issue': for (const ref of m.memories) add(ref, 'memory'); break;
    }
  }
  for (const item of annotations.cases) {
    const source = `case:${item.id}`;
    for (const [target, relation] of [[item.contract, 'contract'], ...item.regressions.map(r => [r, 'regression'])] as const) {
      if (target === undefined || relation === undefined) continue;
      try {
        const owner = resolveReference(repo, documents, target, relation === 'contract' ? ['feature', 'use-case'] : ['memory']);
        if (relation === 'regression' && (owner.metadata.kind !== 'memory' || owner.metadata.memoryKind !== 'problem')) throw new ConcordError('InvalidRegression', 'Regression targets must be Problem Memory');
        if (item.status === 'active') edges.push({ from: source, to: target, relation });
      } catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path: item.file, line: item.line, message: cause instanceof Error ? cause.message : String(cause) }); }
    }
  }
  // Implementation associations are independent of test declarations and fixed evidence.
  const code = options.includeCode === false ? undefined : scanCode(repo);
  const codeDeclarations: readonly CodeDeclaration[] = code?.codes ?? [];
  findings.push(...(code?.findings ?? []));
  for (const item of codeDeclarations) for (const target of item.contracts) {
    try {
      resolveReference(repo, documents, target, ['feature', 'use-case']);
      edges.push({ from: `code:${item.id}`, to: target, relation: 'implements' });
    } catch (cause) { findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path: item.file, line: item.line, message: cause instanceof Error ? cause.message : String(cause) }); }
  }
  const memories = documents.flatMap(doc => doc.metadata.kind === 'memory' && doc.metadata.resolution !== undefined
    ? [{ path: doc.path, evidenceLevel: doc.metadata.resolution.evidenceLevel, evidence: inspectResolutionEvidence(repo, doc.metadata.resolution) }]
    : []);
  return { documents, annotations, codeDeclarations, codeFiles: code?.files ?? [], edges, findings, memories };
}
export function requireValidTrace(trace: ReturnType<typeof buildTrace>): void {
  if (trace.findings.length) throw new ConcordError('TraceInvalid', 'Fix the reported source or contract findings before continuing', trace.findings);
}
const pathOf = (ref: string) => ref.split('#')[0]!;
function belongsTo(repo: Repository, trace: ReturnType<typeof buildTrace>, selectedPaths: ReadonlySet<string>, ref: string): boolean {
  const owner = resolveReference(repo, trace.documents, ref);
  return selectedPaths.has(owner.path) || (owner.metadata.kind === 'use-case' && selectedPaths.has(owner.metadata.feature));
}
// @concord-code query-contract-relations
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md
export function traceShow(repo: Repository, selector: string, cache: 'use' | 'off' = 'use') {
  const trace = buildTrace(repo, cache); requireValidTrace(trace);
  const document = findDocument(trace.documents, selector);
  const relatedPaths = new Set([document.path]);
  if (document.metadata.kind === 'feature') for (const doc of trace.documents) if (doc.metadata.kind === 'use-case' && pathOf(doc.metadata.feature) === document.path) relatedPaths.add(doc.path);
  const incoming = trace.edges.filter(e => belongsTo(repo, trace, relatedPaths, e.to));
  for (const edge of incoming) relatedPaths.add(pathOf(edge.to));
  const outgoing = trace.edges.filter(e => relatedPaths.has(e.from));
  const ids = new Set(incoming.filter(e => e.from.startsWith('case:')).map(e => e.from.slice(5)));
  const codeIds = new Set(incoming.filter(e => e.from.startsWith('code:')).map(e => e.from.slice(5)));
  const codeDeclarations = trace.codeDeclarations.filter(c => codeIds.has(c.id)).map(c => ({ ...c, matchedContracts: c.contracts.filter(ref => belongsTo(repo, trace, relatedPaths, ref)) }));
  return { operation: 'trace-show', subject: document, relatedPaths: [...relatedPaths], incoming, outgoing, tests: trace.annotations.cases.filter(c => ids.has(c.id)), codeDeclarations, cache: trace.annotations.cache };
}
export function selectCase(cases: readonly AnnotatedCase[], id: string): AnnotatedCase {
  const matches = cases.filter(c => c.id === id);
  if (matches.length !== 1) throw new ConcordError(matches.length ? 'CaseAmbiguous' : 'CaseNotFound', `Expected one case for ${id}, found ${matches.length}`);
  return matches[0]!;
}
// @concord-code render-contract-review
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md
export function renderReview(repo: Repository, selector: string | undefined, cache: 'use' | 'off' = 'use'): string {
  const trace = buildTrace(repo, cache); requireValidTrace(trace);
  const docs: readonly DocumentRecord[] = selector ? [findDocument(trace.documents, selector)] : trace.documents;
  const selectedPaths = new Set(docs.map(d => d.path));
  const cases = selector ? trace.annotations.cases.filter(c => belongsTo(repo, trace, selectedPaths, c.contract) || c.regressions.some(r => belongsTo(repo, trace, selectedPaths, r))) : trace.annotations.cases;
  const codes = selector ? trace.codeDeclarations.filter(c => c.contracts.some(ref => belongsTo(repo, trace, selectedPaths, ref))) : trace.codeDeclarations;
  const lines = ['# Concord review', '', 'This is local review material. Code declarations describe implementation associations, not completion or test coverage. Test annotations describe ownership; command evidence does not prove native case coverage.', '', '## Contracts and decisions', ''];
  for (const d of docs.filter(d => d.metadata.kind !== 'memory' && d.metadata.kind !== 'issue')) lines.push(`- [${d.metadata.title}](${d.path}) — ${d.metadata.kind}`);
  lines.push('', '## Code declarations', '');
  for (const c of codes) lines.push(`- **${c.id}** — [${c.file}:${c.line}–${c.endLine}](${c.file}#L${c.line}); ${c.scope}`, ...c.contracts.map(ref => `  - Implements: [${ref}](${ref})`));
  lines.push('', '## Test declarations', '');
  for (const c of cases) lines.push(`- **${c.id}** — [${c.file}:${c.line}](${c.file}#L${c.line}); ${c.status}${c.skipped ? ', skipped/todo' : ''}; contract: [${c.contract}](${c.contract})`, ...c.regressions.map(r => `  - Regression: [${r}](${r})`));
  lines.push('', '## Engineering memory', '');
  const memoryPaths = new Set(cases.flatMap(c => c.regressions.map(pathOf)));
  for (const d of trace.documents) if (d.metadata.kind === 'memory' && (!selector || selectedPaths.has(d.path) || memoryPaths.has(d.path))) {
    const m = d.metadata;
    lines.push(`- [${m.title}](${d.path}) — ${m.memoryKind}, ${m.state}, epoch ${m.epoch}`);
    if (m.resolution) lines.push(`  - Resolution: ${m.resolution.kind}; evidence level: ${m.resolution.evidenceLevel}; ${m.resolution.reason}`, `  - Historical evidence availability: ${JSON.stringify(inspectResolutionEvidence(repo, m.resolution))}`);
  }
  lines.push('', '## Local issue drafts', '');
  for (const d of docs) if (d.metadata.kind === 'issue') lines.push(`- [${d.metadata.title}](${d.path}) — ${d.metadata.state} (local only)`);
  return `${lines.join('\n')}\n`;
}
