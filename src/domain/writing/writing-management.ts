import { ConcordError, digest, inRepositorySnapshot, type Repository } from "../../model/index.js";
import type { LocalRepository } from "../../base/workspace/index.js";
import { readWritingPolicy } from "./writing-policy.js";
import type { WritingPolicy } from "../../model/index.js";
import { applies, discovered, indexWritingScopes, globalPolicyPath, scopeOf } from "../../model/index.js";
import { effectiveConcepts, indexConcepts, spellingKey } from "../concepts/index.js";

export const WRITING_POLICY_PATH = globalPolicyPath;
// @concord-begin
// @concord-implements docs/feature/documentation-quality/format.md
export const writingIndex = indexWritingScopes;
// @concord-end

// @concord-code
// @concord-implements docs/feature/documentation-quality/format.md
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
    const aggregate = indexConcepts(repo);
    const concepts = effectiveConcepts(`${scope}/_scope.md`, aggregate.catalogs);
    const allDerived = concepts.flatMap(item => item.concept.deprecated.map(term => ({ term, use: item.concept.term, why: item.reference, path: item.path, ref: item.reference, scope: item.scope })));
    const derived = [...new Map(allDerived.map(item => [`${item.ref}:${spellingKey(item.term)}:${spellingKey(item.use)}`, item])).values()];
    const conflicts = aggregate.diagnostics.filter(item => item.scope === undefined || applies(`${scope}/_scope.md`, item.scope));
    return { operation: 'writing-show', state: 'valid' as const, path, scope, digest: sourceDigest, source, policy, concepts, derived, conflicts };
  });
}

