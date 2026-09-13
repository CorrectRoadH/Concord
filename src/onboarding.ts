// @concord-file project-onboarding
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md
import { existsSync } from 'node:fs';
import { loadDocuments, resolveReference } from './documents.js';
import { scanAnnotations } from './annotations.js';
import { ConcordError, slug, type Repository } from './shared.js';
import { buildTrace } from './trace.js';


export function doctor(repo: Repository) {
  const { documents, annotations, codeDeclarations, findings } = buildTrace(repo, 'off');
  const missingTestRoots = repo.config.testRoots.filter(path => !existsSync(repo.absolute(path)));
  const missingSourceRoots = (repo.config.sourceRoots ?? []).filter(path => !existsSync(repo.absolute(path)));
  return { operation: 'doctor', ok: findings.length === 0, root: repo.root, node: process.version, configuration: repo.config, missingTestRoots, missingSourceRoots, codeDeclarations: codeDeclarations.length, documents: documents.length, cases: annotations.cases.length, findings, nextSteps: repo.config.testRoots.length === 0 ? ['Maintain contracts with concord --skill document.', 'Run concord check to validate document integrity; this does not prove test coverage.', 'Add testRoots to concord.json when real tests exist.'] : annotations.cases.length === 0 ? ['Fill in a Feature and Use Case.', 'Use concord test annotate to connect an existing test.', 'Configure your runner in concord.json; doctor does not execute it.'] : ['Run concord check to validate all relations.', 'Run concord test run <id> to record command evidence.'] };
}

export function annotationSnippet(repo: Repository, id: string, contract: string, regressions: readonly string[]) {
  slug(id);
  const documents = loadDocuments(repo);
  resolveReference(repo, documents, contract, ['feature', 'use-case']);
  if (new Set(regressions).size !== regressions.length) throw new ConcordError('DuplicateRegression', 'Each Problem reference must appear once');
  for (const ref of regressions) {
    const owner = resolveReference(repo, documents, ref, ['memory']);
    if (owner.metadata.kind !== 'memory' || owner.metadata.memoryKind !== 'problem') throw new ConcordError('InvalidRegression', `${ref} is not a Problem Memory`);
  }
  const snapshot = scanAnnotations(repo, { cache: 'off' });
  if (snapshot.cases.some(item => item.id === id)) throw new ConcordError('CaseExists', `${id} is already declared; edit its existing annotations`);
  const snippet = [`// @concord-case ${id}`, `// @concord-contract ${contract}`, ...regressions.map(ref => `// @concord-regression ${ref}`)].join('\n') + '\n';
  return { operation: 'test-annotate', id, snippet };
}
