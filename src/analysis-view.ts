// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { Schema } from 'effect';
import { AnalysisObservationSchema, type AnalysisObservation } from './analysis-values.js';
import { referenceResolver } from './refs.js';
import { readAnalysisObservations } from './code-analysis.js';
import { RelevanceSchema, type Relevance } from './observation.js';
import type { AnnotatedCase, DocumentRecord, Repository } from './shared.js';
import type { CodeDeclaration } from './code.js';
import { extractSteps } from './steps.js';

export const AnalysisViewSchema = Schema.Struct({
  observations: Schema.Array(AnalysisObservationSchema),
  relevance: Schema.Array(Schema.Struct({ testId: Schema.String, scope: Schema.Literal('file'), relevance: RelevanceSchema, message: Schema.String })),
});
export type AnalysisView = typeof AnalysisViewSchema.Type;

/** Step owners can supply their already parsed refs after the step parser is integrated. */
export function relevanceFor(test: AnnotatedCase, codes: readonly CodeDeclaration[], observations: readonly AnalysisObservation[], documents: readonly DocumentRecord[], stepRefs: ReadonlySet<string> = new Set(), targets?: ReadonlyMap<string, DocumentRecord>): Relevance {
  const candidates = observations.filter(value => value.value.dependencies.some(dependency => dependency.testId === test.id));
  const current = candidates.filter(value => value.current);
  if (current.length === 0) return { verdict: 'not-observed', gaps: candidates.length > 0
    ? ['SnapshotNotCurrent', ...new Set(candidates.flatMap(value => [...value.gaps, ...value.value.dependencies.filter(dependency => dependency.testId === test.id).flatMap(dependency => dependency.gaps)]))]
    : ['NoAnalyzer'] };
  const dependencies = current.flatMap(value => value.value.dependencies.filter(dependency => dependency.testId === test.id));
  const ids = new Set(dependencies.flatMap(value => value.declarations));
  const gaps = [...new Set([...current.flatMap(value => value.gaps), ...dependencies.flatMap(value => value.gaps)])].sort();
  const testPath = test.contract.split('#')[0]!, testAnchor = test.contract.includes('#');
  const owner = targets?.get(test.contract) ?? documents.find(doc => doc.path === testPath);
  const feature = owner?.metadata.kind === 'use-case' ? owner.metadata.feature : owner?.metadata.kind === 'feature' ? owner.path : undefined;
  const matched: string[] = [];
  let best = 0;
  for (const code of codes.filter(code => ids.has(code.id))) for (const ref of code.contracts) {
    const codePath = ref.split('#')[0]!;
    const codeOwner = targets?.get(ref) ?? documents.find(doc => doc.path === codePath);
    let level = 0;
    if (ref === test.contract) level = testAnchor && stepRefs.has(ref) ? 3 : owner?.metadata.kind === 'use-case' ? 2 : 1;
    else if (owner?.metadata.kind === 'use-case' && codePath === testPath && (!testAnchor || !ref.includes('#'))) level = 2;
    else if (owner?.metadata.kind === 'use-case' && codeOwner?.metadata.kind === 'feature' && codeOwner.path === feature) level = 1;
    else if (owner?.metadata.kind === 'feature' && codeOwner?.metadata.kind === 'feature' && codeOwner.path === owner.path) level = 1;
    else if (owner?.metadata.kind === 'feature' && codeOwner?.metadata.kind === 'use-case' && codeOwner.metadata.feature === feature) level = 1;
    if (level > 0) { matched.push(code.id); best = Math.max(best, level); }
  }
  if (matched.length > 0) return { verdict: 'observed', level: best === 3 ? 'step' : best === 2 ? 'use-case' : 'feature', matched: [...new Set(matched)].sort(), gaps };
  return { verdict: 'not-observed', gaps: gaps.length ? [gaps[0]!, ...gaps.slice(1)] : ['NoSourceImports'] };
}
export function analysisView(repo: Repository, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[], documents: readonly DocumentRecord[]): AnalysisView {
  const observations = readAnalysisObservations(repo);
  const stepRefs = new Set(documents.filter(document => document.metadata.kind === 'use-case').flatMap(document =>
    extractSteps(document.path, repo.read(document.path) ?? '').steps.map(step => `${document.path}#${step.id}`)));
  const references = referenceResolver(repo, documents), targets = new Map<string, DocumentRecord>();
  for (const ref of new Set([...cases.map(test => test.contract), ...codes.flatMap(code => code.contracts)])) {
    try { targets.set(ref, references.resolve(ref)); } catch { /* Static owners report invalid references independently. */ }
  }
  return { observations, relevance: cases.map(test => {
    const relevance = relevanceFor(test, codes, observations, documents, stepRefs, targets);
    return { testId: test.id, scope: 'file' as const, relevance, message: relevance.verdict === 'not-observed' ? '未观察到交集' : `observed (${relevance.level}; FileScope)` };
  }) };
}
/** A historical relation projection cannot authorize relevance for current sources. */
export function historicalAnalysis(view: AnalysisView): AnalysisView {
  if (view.observations.length === 0) return view;
  return {
    observations: view.observations.map(value => ({ ...value, current: false, complete: false, gaps: [...new Set([...value.gaps, 'SnapshotNotCurrent'])] })),
    relevance: view.relevance.map(value => ({ ...value, relevance: { verdict: 'not-observed', gaps: ['SnapshotNotCurrent'] }, message: '未观察到交集' })),
  };
}
