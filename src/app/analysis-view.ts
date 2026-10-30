import { type AnalysisView, relevanceFor } from "../model/index.js";
import { referenceResolver } from "../domain/documents/index.js";
import { readAnalysisObservations } from "./code-analysis.js";
import type { AnnotatedCase, DocumentRecord, Repository } from "../model/index.js";
import type { CodeDeclaration } from "../model/index.js";
import { extractSteps } from "../domain/documents/index.js";
export function analysisView(repo: Repository, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[], documents: readonly DocumentRecord[], references = referenceResolver(repo, documents)): AnalysisView {
  const observations = readAnalysisObservations(repo);
  const stepRefs = new Set(documents.filter(document => document.metadata.kind === 'use-case').flatMap(document =>
    extractSteps(document.path, repo.read(document.path) ?? '').steps.map(step => `${document.path}#${step.id}`)));
  const targets = new Map<string, DocumentRecord>();
  for (const ref of new Set([...cases.map(test => test.contract), ...codes.flatMap(code => code.contracts)])) {
    try { targets.set(ref, references.resolve(ref)); } catch { /* Static owners report invalid references independently. */ }
  }
  return { observations, relevance: cases.map(test => {
    const relevance = relevanceFor(test, codes, observations, documents, stepRefs, targets);
    const dependencies = observations.filter(item => item.current).flatMap(item => item.value.dependencies.filter(dependency => dependency.testId === test.id));
    const scope = dependencies.length > 0 && dependencies.every(item => item.scope === 'native-case') ? 'native-case' as const : 'file' as const;
    return { testId: test.id, scope, relevance, message: relevance.verdict === 'not-observed' ? '未观察到交集' : `observed (${relevance.level}; ${scope === 'file' ? 'FileScope' : 'native-case'})` };
  }) };
}
