// @concord-file
// @concord-implements docs/feature/documentation-quality/format.md
import { Schema } from "effect";
import { repositoryCache } from "./cache-store.ts";
import { readCachePayloads, writeCachePayloads } from "./cache-query.ts";
import { canonical, ConcordError, decode, Nat, objectDigest, type Repository } from "../../model/index.ts";
import { HawdbFailure } from './hawdb-native.ts';
import type { WritingFinding } from "../../model/index.ts";

const Source = Schema.Struct({ path: Schema.String, pointer: Schema.optional(Schema.String), line: Schema.optional(Nat), entry: Schema.optional(Nat), column: Schema.optional(Schema.String), ref: Schema.optional(Schema.String) });
const Findings = Schema.Array(Schema.Struct({
  file: Schema.String, line: Nat, column: Schema.optional(Nat), rule: Schema.String, message: Schema.String, context: Schema.String,
  source: Schema.optional(Source), sources: Schema.optional(Schema.Array(Source)),
}));
const Record = Schema.Struct({ format: Schema.Literal('concord.writing-findings/v1'), inputDigest: Schema.String, findingsDigest: Schema.String, findings: Findings });
const key = (inputDigest: string) => `writing:${objectDigest({ format: 'concord.writing-findings/v1', inputDigest })}`;

export function readWritingFindings(repo: Repository, inputDigest: string): WritingFinding[] | undefined {
  const database = repositoryCache(repo);
  const payload = readCachePayloads(database, 'query_cache', [key(inputDigest)]).get(key(inputDigest));
  if (payload === undefined) return undefined;
  if (Buffer.byteLength(payload) > 8 * 1024 * 1024) throw new HawdbFailure('HawdbLimit', 'Writing findings exceed the 8 MiB cache budget');
  const record = decode(Schema.fromJsonString(Record), payload, 'writing findings cache');
  if (record.findings.length > 10000) throw new HawdbFailure('HawdbLimit', 'Writing findings exceed the 10000 finding cache budget');
  if (record.inputDigest !== inputDigest || record.findingsDigest !== objectDigest(record.findings)) throw new ConcordError('InvalidData', 'Writing findings cache identity or digest differs from the requested entry');
  return [...record.findings];
}

export function writeWritingFindings(repo: Repository, inputDigest: string, findings: readonly WritingFinding[]): void {
  if (findings.length > 10000) throw new HawdbFailure('HawdbLimit', 'Writing findings exceed the 10000 finding cache budget');
  const record = decode(Record, { format: 'concord.writing-findings/v1', inputDigest, findingsDigest: objectDigest(findings), findings }, 'writing findings cache');
  const payload = canonical(record);
  if (Buffer.byteLength(payload) > 8 * 1024 * 1024) throw new HawdbFailure('HawdbLimit', 'Writing findings exceed the 8 MiB cache budget');
  writeCachePayloads(repositoryCache(repo), 'query_cache', [{ key: key(inputDigest), payload }]);
}
