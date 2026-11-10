import { knowledgeSearchRecords, knowledgeIndex, removeIssue, setMarkdown, recoverLocalState, type CreateDocumentInput } from '../../src/app/index.ts';
import { linkIssue } from '../../src/domain/issues/index.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { parseDocumentRecord } from '../../src/domain/documents/index.ts';
import { ConcordError, renderDocument, digest, type DocumentKind } from '../../src/model/index.ts';
import { humanOutput } from '../../src/entry/cli/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { createDocument } from '../support/operations.ts';
import { createConsumer } from '../support/consumer.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);

const Output = Schema.Struct({ operation: Schema.optional(Schema.String), query: Schema.optional(Schema.String), error: Schema.optional(Schema.String), documents: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, title: Schema.String, type: Schema.optional(Schema.String), body: Schema.optional(Schema.String), provider: Schema.optional(Schema.String) }))) });
async function result(root: string, operation: (repo: LocalRepository) => unknown, status = 0) {
 const repo = (await LocalRepository.open(root));
 try { let value: unknown; try { value = (await repo.snapshot(async () => await operation(repo))); } catch (cause) { assert.equal(status, 1, String(cause)); assert.ok(cause instanceof ConcordError); return Schema.decodeUnknownSync(Output)({ error: cause.code }); } assert.equal(status, 0); return Schema.decodeUnknownSync(Output)(value); } finally { repo.close(); }
}
const consumer = async (_name: string) => (await createConsumer());
const create = async (root: string, kind: DocumentKind, id: string, title: string, input: Partial<CreateDocumentInput> = {}) => (await result(root, async repo => (await createDocument(repo, kind, { id, title, ...input }))));
const recall = async (root: string, kind: 'memory' | 'issue', query: string, status = 0) => (await result(root, repo => knowledgeSearchRecords(repo, kind, query), status));
const index = async (root: string, kind: 'memory' | 'issue') => (await result(root, repo => knowledgeIndex(repo, kind)));
const remove = async (root: string, id: string, digest: string, status = 0, dryRun = false) => (await result(root, async repo => (await removeIssue(repo, id, digest, dryRun)), status));
const link = async (root: string, id: string, memory: string) => (await result(root, repo => linkIssue(repo, id, memory)));
async function recover(root: string, status = 0) {
 const value = await runApplication(recoverLocalState(root).pipe(Effect.result));
 if (value._tag === 'Failure') { assert.equal(status, 1); assert.ok(value.failure instanceof ConcordError); return Schema.decodeUnknownSync(Output)({ error: value.failure.code }); }
 assert.equal(status, 0); return Schema.decodeUnknownSync(Output)(value.success);
}
function digestFor(root: string, path: string): string { const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'), parserRuntime); assert.ok(record); return record.digest; }
async function saveBody(root: string, path: string, body: string, expectedDigest: string, status = 0) { const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'), parserRuntime)!; return (await result(root, async repo => (await setMarkdown(repo, path, renderDocument(record.metadata, body), expectedDigest)), status)); }

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#edit
test('packed Memory index and recall return current owner text and digest; edit enforces CAS', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer('memory'));
  (await create(root, 'memory', 'case-note', 'Case note', { body: '# Initial\n\nNeedle in the body.\n' }));
  const path = 'memory/case-note.md';
  const first = digestFor(root, path);
  assert.equal((await index(root, 'memory')).documents?.[0]?.digest, first);
  assert.equal((await recall(root, 'memory', 'needle')).documents?.[0]?.body, '# Initial\n\nNeedle in the body.\n');
  (await saveBody(root, path, '# Updated\n\nAnother term.\n', first));
  assert.equal((await recall(root, 'memory', 'another')).documents?.[0]?.digest, digestFor(root, path));
  assert.deepEqual((await recall(root, 'memory', 'needle')).documents, []);
  assert.equal((await saveBody(root, path, 'stale\n', first, 1)).error, 'FileChangedSinceRead');


})));

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed recall and search require every query term and present a body excerpt', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer('multi-term'));
  (await create(root, 'memory', 'cache', 'HawDB cache', { body: '# Cache\n\nHawDB stores disposable projections.\n' }));
  (await create(root, 'memory', 'other', 'HawDB engine', { body: 'No cache here?\n' }));
  (await create(root, 'memory', 'split', 'Marker title', { body: 'HawDB appears in the body.\n' }));
  const matches = (await recall(root, 'memory', '  HAWDB   PROJECTIONS  ')).documents;
  assert.deepEqual(matches?.map(item => item.path), ['memory/cache.md']);
  assert.equal(matches?.[0]?.body, '# Cache\n\nHawDB stores disposable projections.\n');
  assert.equal(matches?.[0]?.digest, digestFor(root, 'memory/cache.md'));
  assert.deepEqual((await recall(root, 'memory', 'projections hawdb')).documents?.map(item => item.path), ['memory/cache.md']);
  assert.deepEqual((await recall(root, 'memory', 'hawdb marker')).documents?.map(item => item.path), ['memory/split.md']);
  assert.equal((await recall(root, 'memory', ' \t ', 1)).error, 'InvalidInput');

  const human = humanOutput((await recall(root, 'memory', 'HAWDB projections')));
  assert.match(human, /memory\/cache\.md — Cache/u);
  assert.match(human, /HawDB stores disposable projections/u);
  (await create(root, 'issue', 'probe', 'HawDB observation', { body: 'The HawDB cache has a symptom.\n' }));
  (await create(root, 'issue', 'irrelevant', 'HawDB alone', { body: 'A different concern.\n' }));
  assert.deepEqual((await recall(root, 'issue', 'CACHE hawdb')).documents?.map(item => item.path), ['docs/issues/probe.md']);
  assert.equal((await recall(root, 'issue', '  ', 1)).error, 'InvalidInput');
  const issueRecall = humanOutput((await recall(root, 'issue', 'cache hawdb')));
})));


// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('packed recover rolls back prepared Issue deletion, preserves committed deletion, and rejects unknown edits', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer('recovery'));
  const path = 'docs/issues/recoverable.md';
  const journalPath = join(root, '.git/concord/journal.json');
  (await create(root, 'issue', 'recoverable', 'Recoverable', {  }));
  const before = readFileSync(join(root, path), 'utf8');
  const repo = (await LocalRepository.open(root));
  const common = {
    format: 'concord.journal', root, privateDir: repo.privateDir,
    operation: 'remove-issue', directories: [],
    scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
    changes: [{ path, before, after: null, beforeDigest: digest(before), afterDigest: null, mode: 420 }],
  };
  repo.close();
  rmSync(join(root, path));
  writeFileSync(journalPath, `${JSON.stringify({ ...common, phase: 'prepared' })}\n`);
  assert.equal((await recover(root)).operation, 'recover');
  assert.equal(readFileSync(join(root, path), 'utf8'), before);

  rmSync(join(root, path));
  writeFileSync(journalPath, `${JSON.stringify({ ...common, phase: 'committed' })}\n`);
  (await recover(root));
  assert.equal(existsSync(join(root, path)), false);

  writeFileSync(join(root, path), before);
  writeFileSync(journalPath, `${JSON.stringify({ ...common, phase: 'prepared' })}\n`);
  writeFileSync(join(root, path), 'unknown edit\n');
  assert.equal((await recover(root, 1)).error, 'RecoveryConflict');
  assert.equal(readFileSync(join(root, path), 'utf8'), 'unknown edit\n');
  assert.equal(existsSync(journalPath), true);
})));
