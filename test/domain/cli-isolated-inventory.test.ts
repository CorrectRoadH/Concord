import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.ts';
import { diagnoseDocuments } from '../../src/domain/documents/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

const Snippet = Schema.Struct({ snippet: Schema.String });
const Index = Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, id: Schema.String, digest: Schema.String })) });
const Search = Schema.Struct({ documents: Schema.Array(Schema.Struct({ body: Schema.String })) });
const Check = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String })) });

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

async function query<A>(root: string, request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
  const reply = await runApplication(executeQuery(root, request, 'off'));
  assert.equal(reply.exitCode, status);
  return Schema.decodeUnknownSync(schema)(reply.value);
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('local operations isolate unrelated malformed contracts and check reports every failure', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try {
    for (const id of ['target', 'broken-a', 'broken-b']) (await createDocument(repo, 'feature', { id, title: id }));
  } finally { repo.close(); }
  for (const id of ['broken-a', 'broken-b']) write(root, `docs/feature/${id}/README.md`, '---\nformat: concord.document/v1\nkind: feature\n---\n# Incomplete owner\n');
  const reader = (await LocalRepository.open(root, { access: 'read' }));
  try {
    const inventory = diagnoseDocuments(reader);
    assert.equal(inventory.complete, false);
    assert.ok(inventory.documents.some(document => document.path === 'docs/feature/target/README.md'));
    for (const id of ['broken-a', 'broken-b']) assert.ok(inventory.findings.some(finding => finding.path === `docs/feature/${id}/README.md` && finding.code === 'InvalidData'));
  } finally { reader.close(); }
  const target = 'docs/feature/target/README.md';
  const code = await runApplication(executeViewAction(root, { action: 'code.marker', scope: 'file', contracts: [target] }));
  assert.match(Schema.decodeUnknownSync(Snippet)(code).snippet, /@concord-implements docs\/feature\/target\/README.md/u);
  const marker = await runApplication(executeViewAction(root, { action: 'test.marker', contract: target, issues: [] }));
  assert.match(Schema.decodeUnknownSync(Snippet)(marker).snippet, /@feature docs\/feature\/target\/README.md/u);
  await runApplication(executeViewAction(root, { action: 'document.create', kind: 'memory', id: 'repair-note', title: 'Repair note' }));
  const index = await query(root, { name: 'documents.list', input: { kind: 'memory' } }, Index);
  const note = index.documents.find(record => record.path === 'memory/repair-note.md');
  assert.ok(note);
  await runApplication(executeViewAction(root, { action: 'document.set', path: note.path, body: '# Repair note\n\nObserved broken contract metadata.\n', expectedDigest: note.digest }));
  const recalled = await query(root, { name: 'memory.search', input: { query: 'broken contract' } }, Search);
  assert.equal(recalled.documents.length, 1);
  assert.match(recalled.documents[0]!.body, /Observed broken contract metadata/u);
  assert.equal((await query(root, { name: 'documents.list', input: { kind: 'memory' } }, Index)).documents[0]?.id, 'repair-note');
  await runApplication(executeViewAction(root, { action: 'document.create', kind: 'issue', id: 'repair-observation', title: 'Repair observation' }));
  assert.equal((await query(root, { name: 'documents.list', input: { kind: 'issue' } }, Index)).documents[0]?.id, 'repair-observation');
  const checked = await query(root, { name: 'check', input: {} }, Check, 1);
  assert.equal(checked.ok, false);
  for (const id of ['broken-a', 'broken-b']) assert.ok(checked.findings.some(finding => finding.path === `docs/feature/${id}/README.md`));
  await assert.rejects(runApplication(executeViewAction(root, { action: 'code.marker', scope: 'file', contracts: ['docs/feature/broken-a/README.md'] })), { code: 'InvalidData' });
});
