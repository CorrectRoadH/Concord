import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { parseDocumentRecord } from '../../src/domain/documents/index.js';
import { ConcordError, renderDocument, digest, type DocumentKind } from '../../src/model/index.js';
import { knowledgeIndex, knowledgeRecall, setMarkdown, removeIssue, activateMemory, linkIssue, recoverLocalState, type CreateDocumentInput } from '../../src/app/index.js';
import { humanOutput } from '../../src/entry/cli/index.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { createDocument } from '../support/operations.js';
import { createConsumer } from '../support/consumer.js';
const Output = Schema.Struct({ operation: Schema.optional(Schema.String), query: Schema.optional(Schema.String), error: Schema.optional(Schema.String), documents: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, title: Schema.String, type: Schema.optional(Schema.String), status: Schema.String, body: Schema.optional(Schema.String), provider: Schema.optional(Schema.String) }))) });
function result(root: string, operation: (repo: LocalRepository) => unknown, status = 0) {
 const repo = new LocalRepository(root);
 try { let value: unknown; try { value = repo.snapshot(() => operation(repo)); } catch (cause) { assert.equal(status, 1, String(cause)); assert.ok(cause instanceof ConcordError); return Schema.decodeUnknownSync(Output)({ error: cause.code }); } assert.equal(status, 0); return Schema.decodeUnknownSync(Output)(value); } finally { repo.close(); }
}
const consumer = (_name: string) => createConsumer();
const create = (root: string, kind: DocumentKind, id: string, title: string, input: Partial<CreateDocumentInput> = {}) => result(root, repo => createDocument(repo, kind, { id, title, ...input }));
const recall = (root: string, kind: 'memory' | 'issue', query: string, status = 0) => result(root, repo => knowledgeRecall(repo, kind, query), status);
const index = (root: string, kind: 'memory' | 'issue') => result(root, repo => knowledgeIndex(repo, kind));
const remove = (root: string, id: string, digest: string, status = 0, dryRun = false) => result(root, repo => removeIssue(repo, id, digest, dryRun), status);
const activate = (root: string, id: string, reason: string) => result(root, repo => activateMemory(repo, id, reason));
const link = (root: string, id: string, memory: string) => result(root, repo => linkIssue(repo, id, memory));
async function recover(root: string, status = 0) {
 const value = await runApplication(recoverLocalState(root).pipe(Effect.result));
 if (value._tag === 'Failure') { assert.equal(status, 1); assert.ok(value.failure instanceof ConcordError); return Schema.decodeUnknownSync(Output)({ error: value.failure.code }); }
 assert.equal(status, 0); return Schema.decodeUnknownSync(Output)(value.success);
}
function digestFor(root: string, path: string): string { const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8')); assert.ok(record); return record.digest; }
function saveBody(root: string, path: string, body: string, expectedDigest: string, status = 0) { const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'))!; return result(root, repo => setMarkdown(repo, path, renderDocument(record.metadata, body), expectedDigest), status); }

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed Memory index and recall return current owner text and digest; edit enforces CAS', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('memory');
  create(root, 'memory', 'case-note', 'Case note', { memoryKind: 'note', body: '# Initial\n\nNeedle in the body.\n' });
  const path = 'memory/case-note.md';
  const first = digestFor(root, path);
  assert.equal(index(root, 'memory').documents?.[0]?.digest, first);
  assert.equal(recall(root, 'memory', 'needle').documents?.[0]?.body, '# Initial\n\nNeedle in the body.\n');
  saveBody(root, path, '# Updated\n\nAnother term.\n', first);
  assert.equal(recall(root, 'memory', 'another').documents?.[0]?.digest, digestFor(root, path));
  assert.deepEqual(recall(root, 'memory', 'needle').documents, []);
  assert.equal(saveBody(root, path, 'stale\n', first, 1).error, 'PreimageChanged');


})));

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed recall and search require every query term and present a body excerpt', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('multi-term');
  create(root, 'memory', 'cache', 'HawDB cache', { memoryKind: 'note', body: '# Cache\n\nHawDB stores disposable projections.\n' });
  create(root, 'memory', 'other', 'HawDB engine', { memoryKind: 'note', body: 'No cache here?\n' });
  create(root, 'memory', 'split', 'Marker title', { memoryKind: 'note', body: 'HawDB appears in the body.\n' });
  const matches = recall(root, 'memory', '  HAWDB   PROJECTIONS  ').documents;
  assert.deepEqual(matches?.map(item => item.path), ['memory/cache.md']);
  assert.equal(matches?.[0]?.body, '# Cache\n\nHawDB stores disposable projections.\n');
  assert.equal(matches?.[0]?.digest, digestFor(root, 'memory/cache.md'));
  assert.deepEqual(recall(root, 'memory', 'projections hawdb').documents?.map(item => item.path), ['memory/cache.md']);
  assert.deepEqual(recall(root, 'memory', 'hawdb marker').documents?.map(item => item.path), ['memory/split.md']);
  assert.equal(recall(root, 'memory', ' \t ', 1).error, 'InvalidInput');

  const human = humanOutput(recall(root, 'memory', 'HAWDB projections'));
  assert.match(human, /memory\/cache\.md — Cache/u);
  assert.match(human, /note: captured/u);
  assert.match(human, /HawDB stores disposable projections/u);
  create(root, 'issue', 'probe', 'HawDB observation', { body: 'The HawDB cache has a symptom.\n' });
  create(root, 'issue', 'irrelevant', 'HawDB alone', { body: 'A different concern.\n' });
  assert.deepEqual(recall(root, 'issue', 'CACHE hawdb').documents?.map(item => item.path), ['docs/issues/probe.md']);
  assert.equal(recall(root, 'issue', '  ', 1).error, 'InvalidInput');
  const issueRecall = humanOutput(recall(root, 'issue', 'cache hawdb'));
  assert.match(issueRecall, /HawDB observation[\s\S]*issue: open[\s\S]*HawDB cache has a symptom/u);
})));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('packed Issue workflow needs no provider, and deletion preserves linked or historical evidence', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('issue');
  create(root, 'issue', 'draft-one', 'Local observation', { body: 'A local symptom.\n' });
  const path = 'docs/issues/draft-one.md';
  const first = digestFor(root, path);
  assert.equal(recall(root, 'issue', 'symptom').documents?.[0]?.provider, 'local');
  assert.equal(recall(root, 'issue', 'symptom').documents?.[0]?.body, '# Local observation\n\nA local symptom.\n');
  saveBody(root, path, '# Local observation\n\nUpdated symptom.\n', first);
  const current = digestFor(root, path);
  assert.equal(remove(root, 'draft-one', first, 1, false).error, 'PreimageChanged');
  remove(root, 'draft-one', current, 0, true);
  assert.equal(existsSync(join(root, path)), true);
  remove(root, 'draft-one', current, 0, false);
  assert.equal(existsSync(join(root, path)), false);

  create(root, 'issue', 'linked', 'Linked observation', {  });
  create(root, 'memory', 'linked-memory', 'Linked memory', { memoryKind: 'decision' });
  activate(root, 'linked-memory', 'Adopt');
  link(root, 'linked', 'memory/linked-memory.md');
  const linked = 'docs/issues/linked.md';
  assert.equal(remove(root, 'linked', digestFor(root, linked), 1, false).error, 'IssueNotRemovable');

  create(root, 'issue', 'sourced', 'Sourced', {  });
  const sourced = 'docs/issues/sourced.md';
  const remote = parseDocumentRecord(sourced, readFileSync(join(root, sourced), 'utf8'));
  assert.ok(remote && remote.metadata.kind === 'issue');
  writeFileSync(join(root, sourced), renderDocument({ ...remote.metadata, source: {
    provider: 'github', instance: 'https://api.github.com', id: '123', url: 'https://github.com/example/demo/issues/123',
    title: 'Remote title', body: 'Remote body', state: 'open', updatedAt: '2026-09-23T00:00:00Z', connectionId: 'external', importedAt: '2026-09-23T00:00:00Z',
  } }, remote.body));
  assert.equal(recall(root, 'issue', 'Sourced').documents?.find(item => item.path === sourced)?.provider, 'github');
  assert.equal(remove(root, 'sourced', digestFor(root, sourced), 1, false).error, 'IssueNotRemovable');

  create(root, 'issue', 'canonical', 'Canonical', { body: '# Anchor heading\n\nOriginal report.\n' });
  create(root, 'issue', 'duplicate', 'Duplicate', {  });
  const duplicate = 'docs/issues/duplicate.md';
  const referring = parseDocumentRecord(duplicate, readFileSync(join(root, duplicate), 'utf8'));
  assert.ok(referring && referring.metadata.kind === 'issue');
  writeFileSync(join(root, duplicate), renderDocument({ ...referring.metadata, status: 'closed', closure: { kind: 'duplicate', canonical: 'docs/issues/canonical.md#anchor-heading' } }, referring.body));
  assert.equal(remove(root, 'canonical', digestFor(root, 'docs/issues/canonical.md'), 1, false).error, 'IssueNotRemovable');
})));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('packed recover rolls back prepared Issue deletion, preserves committed deletion, and rejects unknown edits', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = consumer('recovery');
  const path = 'docs/issues/recoverable.md';
  const journalPath = join(root, '.git/concord/journal.json');
  create(root, 'issue', 'recoverable', 'Recoverable', {  });
  const before = readFileSync(join(root, path), 'utf8');
  const repo = new LocalRepository(root);
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
