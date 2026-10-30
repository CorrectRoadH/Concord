import { readDocumentReference } from "../documents/index.js";
import { ConcordError, inRepositorySnapshot, type Repository } from "../../model/index.js";
import { checkWriting } from "../writing/index.js";
import { buildTrace } from "../trace/index.js";
import { checkConstitution } from "../constitution/index.js";


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#结果
export function doctor(repo: Repository, trace = buildTrace(repo, 'off'), cache: 'use' | 'off' = 'off') {
  const { documents, annotations, codeDeclarations, findings } = trace;
  const missingTestRoots = repo.config.testRoots.filter(path => !(repo.exists?.(path) ?? repo.files(path).length > 0));
  const missingSourceRoots = (repo.config.sourceRoots ?? []).filter(path => !(repo.exists?.(path) ?? repo.files(path).length > 0));
  const constitutionFindings = checkConstitution(repo);
  let writingComplete = true;
  let writingFindings: { code: string; path: string; line?: number; message: string }[];
  try { writingFindings = checkWriting(repo, undefined, cache === 'use').findings.map(finding => ({ code: finding.rule, path: finding.file, line: finding.line, message: finding.message })); }
  catch (cause) { if (!(cause instanceof ConcordError)) throw cause; writingComplete = false; writingFindings = [{ code: cause.code, path: 'docs', message: cause.message }]; }
  const allFindings = [...findings, ...writingFindings, ...constitutionFindings.filter((finding) => !findings.some((existing) => existing.code === finding.code && existing.path === finding.path))];
  const constitutionSteps = constitutionFindings.some((finding) => finding.code === 'ConstitutionDraft') ? ['Adopt real project principles with concord constitution adopt; draft is not compliance.'] : [];
  return { operation: 'doctor', ok: findings.length === 0 && writingComplete && writingFindings.length === 0, writing: { complete: writingComplete, ok: writingComplete && writingFindings.length === 0 }, root: repo.root, node: repo.runtimeVersion ?? 'unknown', configuration: repo.config, missingTestRoots, missingSourceRoots, codeDeclarations: codeDeclarations.length, documents: documents.length, cases: annotations.cases.length, findings: allFindings, nextSteps: [...constitutionSteps, ...(repo.config.testRoots.length === 0 ? ['Maintain contracts with concord --skill document.', 'Run concord check to validate document integrity; this does not prove test coverage.', `Add testRoots to ${repo.configSnapshot.path} when real tests exist.`] : annotations.cases.length === 0 ? ['Fill in a Feature and Use Case.', 'Use concord test annotate to connect an existing test.', `Configure your runner in ${repo.configSnapshot.path}; doctor does not execute it.`] : ['Run concord check to validate all relations.', 'Configure runner to run tests and verify fixes.'])] };
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#annotate
export function annotationSnippet(repo: Repository, contract: string, issues: readonly string[]) {
  return inRepositorySnapshot(repo, () => {
  const target = readDocumentReference(repo, contract, ['feature', 'use-case']);
  if (new Set(issues).size !== issues.length) throw new ConcordError('DuplicateIssue', 'Each Issue reference must appear once');
  for (const ref of issues) {
    const owner = readDocumentReference(repo, ref, ['issue']);
    if (owner.metadata.kind !== 'issue') throw new ConcordError('InvalidIssue', `${ref} is not an Issue`);
  }
  const tag = target.metadata.kind === 'use-case' ? '@use-case' : '@feature';
  const snippet = [`// ${tag} ${contract}`, ...issues.map(ref => `// @issue ${ref}`)].join('\n') + '\n';
  return { operation: 'test-annotate', snippet };
  });
}
