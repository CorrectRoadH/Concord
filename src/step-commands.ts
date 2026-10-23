import { readDocumentSelector } from './documents.js';
import { buildTrace, stepGroups } from './trace.js';
import { formatStepSource, planStepRename } from './step-rewrite.js';
import { ConcordError, inRepositorySnapshot, type Repository } from './shared.js';
import type { LocalRepository } from './storage.js';

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#步骤分组输出
export function useCaseSteps(repo: Repository, selector: string) {
  return inRepositorySnapshot(repo, () => {
    const document = readDocumentSelector(repo, selector, 'use-case');
    const trace = buildTrace(repo);
    return { operation: 'use-case-steps', ...stepGroups(repo, trace, document), findings: trace.findings, complete: trace.complete };
  });
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#主流程
export function formatUseCase(repo: Repository, selector: string, seed = false, list?: number, dryRun = false) {
  return inRepositorySnapshot(repo, () => {
    const document = readDocumentSelector(repo, selector, 'use-case');
    const before = repo.read(document.path)!;
    const after = formatStepSource(repo, document.path, before, seed, list);
    return repo.publish('format-use-case', before === after ? [] : [{ path: document.path, before, after }], dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#主流程
export function renameUseCaseStep(repo: LocalRepository, selector: string, oldId: string, newId: string, dryRun = false) {
  return inRepositorySnapshot(repo, () => {
    const document = readDocumentSelector(repo, selector, 'use-case');
    const plan = planStepRename(repo, { useCase: document.path, oldId, newId });
    if (!plan.changes.length) throw new ConcordError('AnchorNotFound', 'Step rename has no target marker');
    return { ...repo.publishStepRename(plan, dryRun), affectedCases: plan.affectedCases, evidence: 'Previous receipts cannot be reused for the renamed target' };
  });
}
