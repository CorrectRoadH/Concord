import { readDocumentSelector } from "../domain/documents/index.ts";
import { buildTrace } from "../domain/trace/index.ts";
import { stepGroups } from "./trace-queries.ts";
import { formatStepSource, planStepRename } from "./step-rewrite.ts";
import { ConcordError, inRepositorySnapshot, type Repository } from "../model/index.ts";
import type { LocalRepository } from "../base/workspace/index.ts";

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#步骤分组输出
export async function useCaseSteps(repo: Repository, selector: string) {
  return (await inRepositorySnapshot(repo, async () => {
    const document = readDocumentSelector(repo, selector, 'use-case');
    const trace = (await buildTrace(repo));
    return { operation: 'use-case-steps', ...(await stepGroups(repo, trace, document)), findings: trace.findings, complete: trace.complete };
  }));
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#主流程
export async function formatUseCase(repo: Repository, selector: string, seed = false, list?: number, dryRun = false) {
  return (await inRepositorySnapshot(repo, async () => {
    const document = readDocumentSelector(repo, selector, 'use-case');
    const before = repo.read(document.path)!;
    const after = (await formatStepSource(repo, document.path, before, seed, list));
    return (await repo.publish('format-use-case', before === after ? [] : [{ path: document.path, before, after }], dryRun));
  }));
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#主流程
export async function renameUseCaseStep(repo: LocalRepository, selector: string, oldId: string, newId: string, dryRun = false) {
  return (await inRepositorySnapshot(repo, async () => {
    const document = readDocumentSelector(repo, selector, 'use-case');
    const plan = (await planStepRename(repo, { useCase: document.path, oldId, newId }));
    if (!plan.changes.length) throw new ConcordError('AnchorNotFound', 'Step rename has no target marker');
    return { ...(await repo.publishStepRename(plan, dryRun)), affectedCases: plan.affectedCases, evidence: 'Previous receipts cannot be reused for the renamed target' };
  }));
}
