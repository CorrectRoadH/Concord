import { ConcordError, type Repository } from "../model/index.ts";
import { checkWriting } from "../domain/writing/index.ts";
import { buildTrace } from "../domain/trace/index.ts";
import { checkTaste } from "../domain/taste/index.ts";
import { selectWritingGuide, uninitializedDoctor, withLibraryVersionDiagnostic } from './project-onboarding.ts';
import { inspectWorkflowSkills } from './workflow-skills.ts';



// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#结果
// @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
export function doctor(repo: Repository, trace?: ReturnType<typeof buildTrace>, cache: 'use' | 'off' = 'off') {
  if (repo.read('docs/taste.md') === undefined) {
    const guide = selectWritingGuide(repo.root);
    return uninitializedDoctor({ root: repo.root, guide }, repo.runtimeVersion ?? 'unknown', repo.config);
  }
  trace ??= buildTrace(repo, 'off');
  const { documents, annotations, codeDeclarations, findings } = trace;
  const missingTestRoots = repo.config.testRoots.filter(path => !(repo.exists?.(path) ?? repo.files(path).length > 0));
  const missingSourceRoots = (repo.config.sourceRoots ?? []).filter(path => !(repo.exists?.(path) ?? repo.files(path).length > 0));
  const tasteFindings = checkTaste(repo);
  let writingComplete = true;
  let writingFindings: { code: string; path: string; line?: number; message: string }[];
  try { writingFindings = checkWriting(repo, undefined, cache === 'use').findings.map(finding => ({ code: finding.rule, path: finding.file, line: finding.line, message: finding.message })); }
  catch (cause) { if (!(cause instanceof ConcordError)) throw cause; writingComplete = false; writingFindings = [{ code: cause.code, path: 'docs', message: cause.message }]; }
  const allFindings = [...findings, ...writingFindings, ...tasteFindings.filter((finding) => !findings.some((existing) => existing.code === finding.code && existing.path === finding.path))];
  const tasteSteps = tasteFindings.some((finding) => finding.code === 'TasteMissing') ? ['Write project taste in docs/taste.md.'] : [];
  const skills = inspectWorkflowSkills(repo);
  if (!skills.installed || skills.advisories.length > 0) tasteSteps.push('Run concord skills install.');
  return withLibraryVersionDiagnostic({ operation: 'doctor', ok: findings.length === 0 && writingComplete && writingFindings.length === 0, writing: { complete: writingComplete, ok: writingComplete && writingFindings.length === 0 }, root: repo.root, node: repo.runtimeVersion ?? 'unknown', configuration: repo.config, missingTestRoots, missingSourceRoots, codeDeclarations: codeDeclarations.length, documents: documents.length, cases: annotations.cases.length, findings: allFindings, advisories: [...trace.advisories, ...skills.advisories], nextSteps: [...tasteSteps, ...(repo.config.testRoots.length === 0 ? ['Maintain contracts with concord --skill document.', 'Run concord check to validate document integrity; this does not prove test coverage.', `Add testRoots to ${repo.configSnapshot.path} when real tests exist.`] : annotations.cases.length === 0 ? ['Fill in a Feature and Use Case.', 'Use concord test marker to connect an existing test.', `Configure your runner in ${repo.configSnapshot.path}; doctor does not execute it.`] : ['Run concord check to validate all relations.', 'Configure runner to run tests and verify fixes.'])] });
}
