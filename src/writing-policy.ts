// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/apply-controlled-writing.md
// @concord-implements docs/feature/documentation-quality/README.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { Predicate } from 'effect';
import { validateControlled } from './writing-controlled-policy.js';
import { ConcordError, decode } from './shared.js';
import { canonicalPath } from './storage.js';
import { WritingPolicySchema, WritingPolicyV2Schema, type WritingPolicy } from './writing-schema.js';
import { spellingKey, spellingPositions } from './concepts.js';
import { scopeOf, under } from './writing-scopes.js';
export { WritingPolicySchema, type WritingPolicy, type BannedTerm } from './writing-schema.js';
export function readWritingPolicy(source: string, path = 'docs/concord-writing.json', managed = true, migration = false): WritingPolicy {
  try {
    const input: unknown = JSON.parse(source);
    if (Predicate.isObject(input) && ['concord.writing/v1', 'concord.writing/v2'].includes(String(input.format)) && !migration) throw new ConcordError('WritingMigrationRequired', `${path}: ${String(input.format)} requires explicit migration; use writing migrate for v2, or writing show, concepts set and writing set for v1`);
    if (migration && Predicate.isObject(input) && input.format === 'concord.writing/v1') throw new ConcordError('WritingMigrationRequired', `${path}: writing/v1 requires reviewed concept migration with writing show, concepts set and writing set; writing migrate accepts only complete v2 policies`);
    if (typeof input === 'object' && input !== null) {
      const removed = ['svgTerms', 'svgStyle'].filter(key => Object.hasOwn(input, key));
      if (removed.length) throw new Error(`${path}: SVG writing checks were removed (${removed.join(', ')}). Use writing show to retain source and digest; remove only these fields, then writing set --body <file> --expected-digest <digest>.`);
    }
    const policy: WritingPolicy = migration ? { ...decode(WritingPolicyV2Schema, input, 'writing v2 policy'), format: 'concord.writing/v3' } : decode(WritingPolicySchema, input, 'writing policy');
    validateControlled(policy.controlled, path);
    const scope = managed ? scopeOf(path, 'policy') : 'docs';
    const paths = [...(policy.roots ?? [])];
    const seen = new Set<string>();
    for (const ban of policy.bannedTerms) {
      if (ban.term !== ban.term.trim()) throw new Error('Banned terms cannot have leading or trailing whitespace');
      const key = spellingKey(ban.term);
      if (seen.has(key)) throw new Error(`Duplicate banned term: ${ban.term}`);
      seen.add(key);
      paths.push(...(ban.roots ?? []), ...(ban.exempt ?? []));
      if (ban.roots?.length === 0) throw new Error(`Empty roots for ${ban.term}`);
      for (const word of ban.allowIn ?? []) if (word === ban.term || spellingPositions(word, ban.term).length === 0) throw new Error(`allowIn must contain a longer matching term ${ban.term}`);
    }
    for (const path of paths) {
      canonicalPath(path);
      if (path.split('/').some(part => part === '.git' || part === 'node_modules' || part === '_template')) throw new Error(`Excluded path: ${path}`);
      if (managed && scope !== 'docs' && !under(path, scope)) throw new Error(`Local policy path escapes ${scope}: ${path}`);
    }
    if (policy.sentenceLength !== undefined && policy.sentenceLength !== null && policy.paragraphLength !== undefined && policy.paragraphLength !== null && policy.paragraphLength < policy.sentenceLength) throw new Error('paragraphLength must be at least sentenceLength');
    return policy;
  } catch (cause) {
    if (cause instanceof ConcordError && ['WritingMigrationRequired', 'WritingBudgetExceeded', 'InvalidWritingPolicy'].includes(cause.code)) throw cause;
    throw new ConcordError('InvalidWritingPolicy', cause instanceof Error ? cause.message : String(cause));
  }
}
export { under } from './writing-scopes.js';
