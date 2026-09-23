// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { ConcordError, digest, inRepositorySnapshot, type Repository } from './shared.js';
import type { LocalRepository } from './storage.js';
import { readWritingPolicy, type WritingPolicy } from './writing-policy.js';
import { applies, indexWritingScopes, globalPolicyPath, scopeOf } from './writing-scopes.js';
import { effectiveConcepts, indexConcepts, spellingKey } from './concepts.js';

export const WRITING_POLICY_PATH = globalPolicyPath;
export const writingIndex = indexWritingScopes;

export function showWriting(repo: Repository, path = globalPolicyPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'policy');
    const source = repo.read(path);
    if (source === undefined) return { operation: 'writing-show', state: 'missing' as const, path, scope, digest: null, source: null, policy: null, concepts: [], derived: [], conflicts: [] };
    const sourceDigest = digest(source);
    let policy: WritingPolicy;
    try { policy = readWritingPolicy(source, path); }
    catch (cause) {
      return { operation: 'writing-show', state: 'invalid' as const, path, scope, digest: sourceDigest, source, policy: null, diagnostic: cause instanceof Error ? cause.message : String(cause), concepts: [], derived: [], conflicts: [] };
    }
    const aggregate = indexConcepts(repo);
    const concepts = effectiveConcepts(`${scope}/_scope.md`, aggregate.catalogs);
    const allDerived = concepts.flatMap(item => Object.entries(item.concept.names).flatMap(([language, name]) => (name.deprecated ?? []).map(term => ({ term, use: name.preferred, why: `${item.reference} (${language})`, path: item.path, ref: item.reference, scope: item.scope, language }))));
    const derived = [...new Map(allDerived.map(item => [`${item.ref}:${spellingKey(item.term)}:${spellingKey(item.use)}`, item])).values()];
    const conflicts = aggregate.diagnostics.filter(item => item.scope === undefined || applies(`${scope}/_scope.md`, item.scope));
    return { operation: 'writing-show', state: 'valid' as const, path, scope, digest: sourceDigest, source, policy, concepts, derived, conflicts };
  });
}

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
