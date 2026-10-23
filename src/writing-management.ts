import { ConcordError, digest, inRepositorySnapshot, type Repository } from './shared.js';
import type { LocalRepository } from './storage.js';
import { readWritingPolicy, type WritingPolicy } from './writing-policy.js';
import { composeControlled } from './writing-controlled-policy.js';
import { applies, discovered, indexWritingScopes, globalPolicyPath, scopeOf } from './writing-scopes.js';
import { effectiveConcepts, indexConcepts, spellingKey } from './concepts.js';

export const WRITING_POLICY_PATH = globalPolicyPath;
// @concord-begin
// @concord-implements docs/feature/documentation-quality/policy.md#使用统计与输入快照
export const writingIndex = indexWritingScopes;
// @concord-end

// @concord-code
// @concord-implements docs/feature/documentation-quality/policy.md#工具管理与恢复
export function showWriting(repo: Repository, path = globalPolicyPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'policy');
    const source = repo.read(path);
    if (source === undefined) return { operation: 'writing-show', state: 'missing' as const, path, scope, digest: null, source: null, policy: null, concepts: [], derived: [], conflicts: [] };
    const sourceDigest = digest(source);
    let policy: WritingPolicy;
    try { policy = readWritingPolicy(source, path); }
    catch (cause) {
      return { operation: 'writing-show', state: 'invalid' as const, path, scope, digest: sourceDigest, source, policy: null, diagnostic: cause instanceof Error ? cause.message : String(cause), code: cause instanceof ConcordError ? cause.code : 'InvalidWritingPolicy', concepts: [], derived: [], conflicts: [] };
    }
    const effectiveControlledDiagnostics: { path: string; message: string }[] = [];
    const owners = discovered(repo, 'policy').filter(owner => applies(`${scope}/_scope.md`, scopeOf(owner, 'policy'))).sort((a, b) => a.length - b.length).flatMap(owner => { try { return [{ path: owner, policy: readWritingPolicy(repo.read(owner)!, owner) }]; } catch (cause) { if (!(cause instanceof ConcordError) || !['InvalidWritingPolicy', 'WritingMigrationRequired', 'WritingBudgetExceeded'].includes(cause.code)) throw cause; effectiveControlledDiagnostics.push({ path: owner, message: cause instanceof Error ? cause.message : String(cause) }); return []; } });
    const effectiveControlled = Object.fromEntries(composeControlled(owners, false));
    const aggregate = indexConcepts(repo);
    const concepts = effectiveConcepts(`${scope}/_scope.md`, aggregate.catalogs);
    const allDerived = concepts.flatMap(item => Object.entries(item.concept.names).flatMap(([language, name]) => (name.deprecated ?? []).map(term => ({ term, use: name.preferred, why: `${item.reference} (${language})`, path: item.path, ref: item.reference, scope: item.scope, language }))));
    const derived = [...new Map(allDerived.map(item => [`${item.ref}:${spellingKey(item.term)}:${spellingKey(item.use)}`, item])).values()];
    const conflicts = aggregate.diagnostics.filter(item => item.scope === undefined || applies(`${scope}/_scope.md`, item.scope));
    return { operation: 'writing-show', state: 'valid' as const, path, scope, digest: sourceDigest, source, policy, effectiveControlled, effectiveControlledDiagnostics, concepts, derived, conflicts };
  });
}

// @concord-code
// @concord-implements docs/feature/documentation-quality/policy.md#工具管理与恢复
export function setWriting(repo: LocalRepository, policy: WritingPolicy, expectedDigest: string | null, dryRun = false, path = globalPolicyPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'policy');
    const before = repo.read(path) ?? null;
    if ((before === null ? null : digest(before)) !== expectedDigest) throw new ConcordError('PreimageChanged', 'Writing policy changed; retain the draft and reload before retrying');
    const after = `${JSON.stringify(policy, null, 2)}\n`;
    const validated = readWritingPolicy(after, path);
    const receipt = repo.publish('set-writing-policy', [{ path, before, after }], dryRun);
    return { ...receipt, policy: validated, source: after, digest: digest(after), path, scope };
  });
}

// @concord-code
// @concord-implements docs/feature/documentation-quality/policy.md#从-writingv1-迁移
// @concord-implements docs/feature/documentation-quality/policy.md#从-writingv2-迁移
export function migrateWriting(repo: LocalRepository, path: string, dryRun = false) {
  return inRepositorySnapshot(repo, () => {
    const shown = showWriting(repo, path);
    if (shown.source === null) throw new ConcordError('WritingPolicyNotFound', `Missing writing policy: ${path}`);
    const policy = readWritingPolicy(shown.source, path, true, true);
    return { ...setWriting(repo, policy, shown.digest, dryRun, path), operation: 'writing-migrate', from: 'concord.writing/v2', to: 'concord.writing/v3' };
  });
}
