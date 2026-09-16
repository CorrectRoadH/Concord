// @concord-file project-onboarding
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md
import { existsSync } from 'node:fs';
import { loadDocuments, resolveReference } from './documents.js';
import { scanAnnotations } from './annotations.js';
import { ConcordError, type Repository } from './shared.js';
import { buildTrace } from './trace.js';
import { checkConstitution } from './constitution.js';


export function doctor(repo: Repository, trace = buildTrace(repo, 'off')) {
  const { documents, annotations, codeDeclarations, findings } = trace;
  const missingTestRoots = repo.config.testRoots.filter(path => !existsSync(repo.absolute(path)));
  const missingSourceRoots = (repo.config.sourceRoots ?? []).filter(path => !existsSync(repo.absolute(path)));
  const constitutionFindings = checkConstitution(repo);
  const allFindings = [...findings, ...constitutionFindings.filter((finding) => !findings.some((existing) => existing.code === finding.code && existing.path === finding.path))];
  const constitutionSteps = repo.config.constitution === undefined ? ['Run concord constitution initialize to opt this existing project into constitution governance.'] : constitutionFindings.some((finding) => finding.code === 'ConstitutionDraft') ? ['Adopt real project principles with concord constitution adopt; draft is not compliance.'] : [];
  return { operation: 'doctor', ok: findings.length === 0, root: repo.root, node: process.version, configuration: repo.config, missingTestRoots, missingSourceRoots, codeDeclarations: codeDeclarations.length, documents: documents.length, cases: annotations.cases.length, findings: allFindings, nextSteps: [...constitutionSteps, ...(repo.config.testRoots.length === 0 ? ['Maintain contracts with concord --skill document.', 'Run concord check to validate document integrity; this does not prove test coverage.', `Add testRoots to ${repo.configSnapshot.path} when real tests exist.`] : annotations.cases.length === 0 ? ['Fill in a Feature and Use Case.', 'Use concord test annotate to connect an existing test.', `Configure your runner in ${repo.configSnapshot.path}; doctor does not execute it.`] : ['Run concord check to validate all relations.', 'Run concord test run <id> to record command evidence.'])] };
}

export function annotationSnippet(repo: Repository, contract: string, regressions: readonly string[]) {
  const documents = loadDocuments(repo);
  const target = resolveReference(repo, documents, contract, ['feature', 'use-case']);
  if (new Set(regressions).size !== regressions.length) throw new ConcordError('DuplicateRegression', 'Each Problem reference must appear once');
  for (const ref of regressions) {
    const owner = resolveReference(repo, documents, ref, ['memory']);
    if (owner.metadata.kind !== 'memory' || owner.metadata.memoryKind !== 'problem') throw new ConcordError('InvalidRegression', `${ref} is not a Problem Memory`);
  }
  scanAnnotations(repo, { cache: 'off' });
  const tag = target.metadata.kind === 'use-case' ? '@use-case' : '@feature';
  const snippet = [`// ${tag} ${contract}`, ...regressions.map(ref => `// @regression ${ref}`)].join('\n') + '\n';
  return { operation: 'test-annotate', snippet };
}
