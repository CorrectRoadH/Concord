// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/apply-controlled-writing.md
import { Predicate } from 'effect';
import { ConcordError } from './shared.js';
import type { Controlled, WritingPolicy } from './writing-schema.js';

export const WRITING_PARSER_VERSION = 'controlled-v3.1/legacy-v2/markdown-v1';
export interface PolicySource { path: string; pointer: string }
export interface PolicyLeaf { value: unknown; source?: PolicySource }
export type EffectiveControlled = Map<string, PolicyLeaf>;
const keys = [
  'language', 'paragraphSentences', ...['zh', 'en'].flatMap(l => [`sentence/${l}/procedural`, `sentence/${l}/descriptive`, `procedural/verbs/${l}`, `procedural/allowIn/${l}`, `approvedWords/allowIn/${l}`, `passiveVoice/allowIn/${l}`, `passiveVoice/${l}`]),
  'procedural/singleInstruction', 'procedural/requireVerb', 'approvedWords/en', 'approvedWords/enabled', 'passiveVoice/participles',
];
export function writingBudget(message: string): never {
  throw new ConcordError('WritingBudgetExceeded', message, { complete: false });
}
export const normalizeWriting = (text: string): string => text.normalize('NFC').toLowerCase().replaceAll('’', "'");
export const latinToken = /^[\p{Script=Latin}][\p{Script=Latin}\p{M}]*(?:['’-][\p{Script=Latin}][\p{Script=Latin}\p{M}]*)*$/u;
const surfaces = (key: string, value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  if (key === 'procedural/verbs/en') return (value as NonNullable<NonNullable<Controlled['procedural']>['verbs']>['en'] & {}).flatMap(verb => [verb.lemma, ...(verb.forms ?? [])]);
  return value as string[];
};
export function composeControlled(owners: readonly { path: string; policy: WritingPolicy }[], validate = true): EffectiveControlled {
  const leaves: EffectiveControlled = new Map(keys.map(key => [key, { value: key === 'language' ? 'auto' : /(?:singleInstruction|requireVerb|enabled)$|^passiveVoice\/(?:zh|en)$/u.test(key) ? false : /(?:verbs|allowIn)\//u.test(key) || key === 'approvedWords/en' || key === 'passiveVoice/participles' ? [] : null }]));
  const visit = (value: unknown, pointer: string, path: string): void => {
    if (value === undefined) return;
    const key = pointer.replace(/^\/controlled\/?/u, '');
    if (value === null) {
      for (const leaf of keys) if (!key || leaf === key || leaf.startsWith(`${key}/`)) leaves.set(leaf, { value: null, source: { path, pointer } });
    } else if (Predicate.isObject(value) && !Array.isArray(value)) {
      for (const [field, child] of Object.entries(value)) visit(child, `${pointer}/${field}`, path);
    } else leaves.set(key, { value, source: { path, pointer } });
  };
  for (const owner of owners) visit(owner.policy.controlled, '/controlled', owner.path);
  if (validate) validateEffectiveControlled(leaves);
  return leaves;
}
export function validateControlled(controlled: WritingPolicy['controlled'], path: string): void {
  const policy: WritingPolicy = { format: 'concord.writing/v3', bannedTerms: [], ...(controlled === undefined ? {} : { controlled }) };
  const leaves = composeControlled([{ path, policy }], false);
  for (const [key, leaf] of leaves) {
    const words = surfaces(key, leaf.value);
    if (!Array.isArray(leaf.value)) continue;
    if (words.length > 4096) writingBudget(`${path} /controlled/${key}: more than 4096 surface forms`);
    const seen = new Set<string>();
    for (const word of words) {
      const normalized = normalizeWriting(word);
      const phrase = key.includes('/allowIn/');
      if (phrase && [...normalized].length > 128) writingBudget(`${path} /controlled/${key}: phrase exceeds 128 code points`);
      if (!phrase && !(key.endsWith('/zh') ? /^\p{Script=Han}+$/u : latinToken).test(normalized)) throw new ConcordError('InvalidWritingPolicy', `${path} /controlled/${key}: invalid lexeme ${word}`);
      if (seen.has(normalized)) throw new ConcordError('InvalidWritingPolicy', `${path} /controlled/${key}: duplicate normalized surface ${word}`);
      seen.add(normalized);
    }
  }
}
export function validateEffectiveControlled(leaves: EffectiveControlled): void {
  const get = (key: string) => leaves.get(key)?.value;
  const missing = (toggle: string, table: string): never => {
    const sources = [leaves.get(toggle)?.source, leaves.get(table)?.source].filter(Boolean);
    throw new ConcordError('InvalidWritingPolicy', `${toggle} requires a nonempty ${table}; sources: ${JSON.stringify(sources)}`, { sources, complete: false });
  };
  for (const language of ['zh', 'en']) {
    let count = 0, bytes = 0;
    for (const [key, leaf] of leaves) {
      if (!(key.endsWith(`/${language}`) || (language === 'en' && key === 'passiveVoice/participles'))) continue;
      const words = surfaces(key, leaf.value);
      count += words.length; bytes += words.reduce((sum, word) => sum + Buffer.byteLength(normalizeWriting(word)), 0);
    }
    if (count > 16384 || bytes > 1024 * 1024) writingBudget(`${language}: effective vocabulary exceeds 16384 forms or 1 MiB`);
    if (get('language') == null || get('language') === 'auto' || get('language') === language) for (const toggle of ['procedural/singleInstruction', 'procedural/requireVerb']) {
      if (get(toggle) === true && surfaces(`procedural/verbs/${language}`, get(`procedural/verbs/${language}`)).length === 0) missing(toggle, `procedural/verbs/${language}`);
    }
  }
  if (get('passiveVoice/en') === true && surfaces('passiveVoice/participles', get('passiveVoice/participles')).length === 0) missing('passiveVoice/en', 'passiveVoice/participles');
}
