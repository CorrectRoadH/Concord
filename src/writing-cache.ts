// @concord-file
// @concord-implements docs/feature/documentation-quality/policy.md#使用统计与输入快照
import { Schema } from 'effect';
import { withPersistentCache } from './cache-store.js';
import { readCachePayloads, writeCachePayloads } from './cache-query.js';
import { canonical, decode, Nat, objectDigest, type Repository } from './shared.js';
import type { WritingFinding } from './writing.js';

const Source = Schema.Struct({ path: Schema.String, pointer: Schema.optional(Schema.String), line: Schema.optional(Nat), entry: Schema.optional(Nat), column: Schema.optional(Schema.String), ref: Schema.optional(Schema.String) });
const Position = Schema.Struct({ line: Nat, column: Nat });
const Findings = Schema.Array(Schema.Struct({
  file: Schema.String, line: Nat, column: Schema.optional(Nat), rule: Schema.String, message: Schema.String, context: Schema.String,
  source: Schema.optional(Source), sources: Schema.optional(Schema.Array(Source)), actual: Schema.optional(Schema.Number), limit: Schema.optional(Schema.Number),
  language: Schema.optional(Schema.Literals(['zh', 'en'])), languagePolicy: Schema.optional(Schema.Literals(['auto', 'zh', 'en'])),
  matches: Schema.optional(Schema.Array(Schema.Struct({ text: Schema.String, start: Position, end: Position }))),
})).check(Schema.isMaxLength(10000));
const Record = Schema.Struct({ format: Schema.Literal('concord.writing-findings/v1'), inputDigest: Schema.String, findingsDigest: Schema.String, findings: Findings });
const key = (inputDigest: string) => `writing:${objectDigest({ format: 'concord.writing-findings/v1', inputDigest })}`;

export function readWritingFindings(repo: Repository, inputDigest: string): WritingFinding[] | undefined {
  try {
    return withPersistentCache(repo, false, database => {
      if (database === undefined) return undefined;
      const payload = readCachePayloads(database, 'query_cache', [key(inputDigest)]).get(key(inputDigest));
      if (payload === undefined) return undefined;
      const record = decode(Record, JSON.parse(payload), 'writing findings cache');
      return record.inputDigest === inputDigest && record.findingsDigest === objectDigest(record.findings) ? [...record.findings] : undefined;
    });
  } catch { return undefined; }
}

export function writeWritingFindings(repo: Repository, inputDigest: string, findings: readonly WritingFinding[]): void {
  try {
    const record = decode(Record, { format: 'concord.writing-findings/v1', inputDigest, findingsDigest: objectDigest(findings), findings }, 'writing findings cache');
    const payload = canonical(record);
    if (Buffer.byteLength(payload) > 8 * 1024 * 1024) return;
    withPersistentCache(repo, true, database => writeCachePayloads(database!, 'query_cache', [{ key: key(inputDigest), payload }]));
  } catch { /* Current-source findings remain available when caching is unavailable. */ }
}
