// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#knowledge-search
import { Schema } from 'effect';
import type { HawDBParameter } from '@nowledge/hawdb-bun';
import { HawdbFailure, MIB } from './hawdb-types.ts';
import { KnowledgeDocument, KnowledgeGeneration, KnowledgeResult, KnowledgeUpdate, type KnowledgeKind } from './knowledge-search-model.ts';
import type { NativeDatabase } from './hawdb-native.ts';

const label = (kind: KnowledgeKind) => kind === 'memory' ? 'MemorySearchDocument' : 'IssueSearchDocument';
const documentFields = ['path', 'id', 'title', 'body', 'digest', 'searchText'] as const;
const generationFields = ['kind', 'generation', 'definitionDigest', 'sourceDigest', 'documentCount', 'logicalBytes'] as const;
const decodeGeneration = Schema.decodeUnknownSync(Schema.Array(KnowledgeGeneration), { onExcessProperty: 'error' });
const decodeDocument = Schema.decodeUnknownSync(KnowledgeDocument, { onExcessProperty: 'error' });
export function initializeKnowledgeSchema(db: NativeDatabase): void {
  for (const kind of ['memory', 'issue'] as const) {
    db.exec(`CREATE INDEX ON :${label(kind)}(path)`);
    db.exec(`CREATE CONSTRAINT ON :${label(kind)}(path) ASSERT UNIQUE`);
    for (const field of [...documentFields, ...(kind === 'issue' ? ['provider'] : [])]) db.exec(`CREATE CONSTRAINT ON :${label(kind)}(${field}) ASSERT EXISTS`);
    db.exec(`CREATE FULLTEXT INDEX ON :${label(kind)}(searchText)`);
  }
  db.exec('CREATE CONSTRAINT ON :KnowledgeSearchGeneration(kind) ASSERT UNIQUE');
  for (const field of generationFields) db.exec(`CREATE CONSTRAINT ON :KnowledgeSearchGeneration(${field}) ASSERT EXISTS`);
}
export function knowledgeGenerations(db: NativeDatabase): readonly KnowledgeGeneration[] {
  return decodeGeneration(db.query(`MATCH (g:KnowledgeSearchGeneration) RETURN ${generationFields.map(field => `g.${field} AS ${field}`).join(', ')}`));
}
export function discardKnowledge(db: NativeDatabase, kind: KnowledgeKind): void {
  db.exec(`MATCH (n:${label(kind)}) DELETE n`);
  db.exec('MATCH (g:KnowledgeSearchGeneration) WHERE g.kind = $kind DELETE g', { kind });
}
function* batches<A>(values: readonly A[]): Generator<readonly A[]> {
  let batch: A[] = [], bytes = 0;
  for (const value of values) {
    const size = Buffer.byteLength(JSON.stringify(value));
    if (size > 8 * MIB) throw new HawdbFailure('HawdbLimit', 'Search document exceeds 8 MiB');
    if (batch.length && (batch.length === 1000 || bytes + size > 16 * MIB)) { yield batch; batch = []; bytes = 0; }
    batch.push(value); bytes += size;
  }
  if (batch.length) yield batch;
}
export function updateKnowledge(db: NativeDatabase, input: KnowledgeUpdate, check: () => void): void {
  const update = Schema.decodeUnknownSync(KnowledgeUpdate, { onExcessProperty: 'error' })(input), next = update.generation, kind = next.kind;
  if (Buffer.byteLength(JSON.stringify(update)) > 64 * MIB) throw new HawdbFailure('HawdbLimit', 'Search change set exceeds 64 MiB');
  const previous = knowledgeGenerations(db), prior = previous.find(value => value.kind === kind);
  if (update.previous !== null && prior?.generation !== update.previous) throw new HawdbFailure('HawdbIncompatible', 'Search generation changed; rediscover sources');
  const paths = new Set<string>();
  for (const document of update.documents) {
    if (!document.path || paths.has(document.path) || (kind === 'issue') !== ('provider' in document) || document.searchText !== `${document.title}\n${document.body}`.toLocaleLowerCase()) throw new HawdbFailure('HawdbIncompatible', 'Invalid search document identity');
    paths.add(document.path);
  }
  const others = previous.filter(value => value.kind !== kind);
  if (next.documentCount + others.reduce((n, value) => n + value.documentCount, 0) > 20000 || next.logicalBytes + others.reduce((n, value) => n + value.logicalBytes, 0) > 64 * MIB || !db.memory && db.cacheBytes() + next.logicalBytes + others.reduce((n, value) => n + value.logicalBytes, 0) > 96 * MIB) throw new HawdbFailure('HawdbLimit', 'Complete search collections exceed the shared budget');
  if (update.previous === null) discardKnowledge(db, kind);
  for (const batch of batches([...new Set([...update.removed, ...paths])])) { check(); db.exec(`MATCH (n:${label(kind)}) WHERE n.path IN $paths DELETE n`, { paths: [...batch] }); }
  const fields = [...documentFields, ...(kind === 'issue' ? ['provider'] : [])];
  for (const batch of batches(update.documents)) {
    check();
    db.exec(`UNWIND $rows AS row CREATE (:${label(kind)} {${fields.map(field => `${field}: row.${field}`).join(', ')}})`, { rows: [...batch] });
  }
  const count = db.query(`MATCH (n:${label(kind)}) RETURN count(n) AS count`)[0]?.count;
  if (count !== next.documentCount && count !== BigInt(next.documentCount)) throw new HawdbFailure('HawdbIncompatible', 'Search collection count differs from its generation');
  check();
  db.exec('MATCH (g:KnowledgeSearchGeneration) WHERE g.kind = $kind DELETE g', { kind });
  db.exec(`CREATE (:KnowledgeSearchGeneration {${generationFields.map(field => `${field}: $${field}`).join(', ')}})`, { ...next });
}
/** Native path order is the cursor order; locale order is applied only after completion. */
export function queryKnowledge(db: NativeDatabase, kind: KnowledgeKind, expected: string, terms: readonly string[], check: () => void): KnowledgeResult {
  if (!terms.length || new Set(terms).size > 256 || Buffer.byteLength(terms.join(' ')) > 64 * 1024) throw new HawdbFailure('HawdbLimit', 'Search query exceeds its native budget');
  const generation = knowledgeGenerations(db).find(value => value.kind === kind);
  if (!generation || generation.generation !== expected) throw new HawdbFailure('HawdbIncompatible', 'Search generation does not match observed sources');
  const count = db.query(`MATCH (n:${label(kind)}) RETURN count(n) AS count`)[0]?.count;
  if (count !== generation.documentCount && count !== BigInt(generation.documentCount)) throw new HawdbFailure('HawdbIncompatible', 'Incomplete search generation');
  const fields = [...documentFields, ...(kind === 'issue' ? ['provider'] : [])];
  const collect = (regex: boolean): KnowledgeDocument[] => {
    const parameters: Record<string, HawDBParameter> = Object.fromEntries(terms.map((term, index) => [`q${index}`, regex ? '(?s).*' + term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '.*' : term]));
    const documents: KnowledgeDocument[] = [], seen = new Set<string>();
    let bytes = 0, after: string | undefined;
    while (true) {
      check();
      const rows = db.query(`MATCH (n:${label(kind)}) WHERE ${terms.map((_, index) => `n.searchText ${regex ? '=~' : 'CONTAINS'} $q${index}`).join(' AND ')}${after === undefined ? '' : ' AND n.path > $after'} RETURN ${fields.map(field => `n.${field} AS ${field}`).join(', ')} ORDER BY n.path LIMIT 1000`, { ...parameters, ...(after === undefined ? {} : { after }) });
      for (const row of rows) {
        const document = decodeDocument(row);
        bytes += Buffer.byteLength(JSON.stringify(document));
        if (seen.has(document.path)) throw new HawdbFailure('HawdbIncompatible', 'Repeated search result path');
        seen.add(document.path); documents.push(document); after = document.path;
        if (documents.length > 20000 || bytes > 64 * MIB) throw new HawdbFailure('HawdbLimit', 'Complete search result exceeds its budget');
      }
      if (rows.length < 1000) return documents;
    }
  };
  let documents = collect(false);
  if (!documents.length) { check(); documents = collect(true); }
  check();
  documents.sort((a, b) => a.path.localeCompare(b.path));
  return Schema.decodeUnknownSync(KnowledgeResult, { onExcessProperty: 'error' })({ generation, documents });
}
