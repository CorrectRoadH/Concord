import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { executeQuery, executeViewAction } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

const Rows = Schema.Struct({ operation: Schema.String, documents: Schema.Array(Schema.Json) });
const Inventory = Schema.Struct({
  ...Rows.fields,
  complete: Schema.Boolean,
  findings: Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String })),
});
const decode = Schema.decodeUnknownSync(Inventory, { onExcessProperty: 'error' });

async function consumer(run: (root: string) => Promise<void>): Promise<void> {
  const root = createConsumer();
  try {
    const repo = new LocalRepository(root);
    try {
      createDocument(repo, 'issue', { id: 'healthy', title: 'Healthy issue' });
      createDocument(repo, 'memory', { id: 'healthy', title: 'Healthy memory' });
    } finally { repo.close(); }
    await run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/document-packages/use-case/discover-managed-documents.md#partial-list
test('list preserves healthy rows and reports malformed documents without rewriting them', () => consumer(async root => {
  for (const kind of ['issue', 'memory', undefined] as const) {
    const request = { name: 'documents.list' as const, input: { kind } };
    const baseline = await runApplication(executeQuery(root, request, 'off'));
    const rows = Schema.decodeUnknownSync(Rows)(baseline.value);
    const path = kind === 'memory' ? 'memory/broken.md' : 'docs/issues/broken.md';
    const source = 'This document has no level-one heading.\n';
    writeFileSync(join(root, path), source);
    const reply = await runApplication(executeQuery(root, request, 'off'));
    assert.equal(reply.exitCode, 0);
    const value = decode(reply.value);
    assert.deepEqual(value.documents, rows.documents);
    assert.equal(value.operation, 'list');
    assert.equal(value.complete, false);
    assert.deepEqual(value.findings.map(({ code, path }) => ({ code, path })), [{ code: 'InvalidData', path }]);
    assert.equal(value.findings[0]?.message, `${path}: expected exactly one single-line level-one heading (at most 1024 characters)`);
    assert.equal(readFileSync(join(root, path), 'utf8'), source);
    rmSync(join(root, path));
  }
}));

// @use-case docs/feature/document-packages/use-case/discover-managed-documents.md#partial-list
test('list and knowledge indexes return explicit completeness and isolate their scan kinds', () => consumer(async root => {
  for (const kind of ['issue', 'memory'] as const) {
    const request = { name: 'documents.list' as const, input: { kind } };
    const reply = await runApplication(executeQuery(root, request, 'off'));
    assert.equal(reply.exitCode, 0);
    const baseline = decode(reply.value);
    assert.equal(baseline.complete, true);
    assert.deepEqual(baseline.findings, []);
    const otherPath = kind === 'issue' ? 'memory/broken.md' : 'docs/issues/broken.md';
    writeFileSync(join(root, otherPath), 'No heading\n');
    assert.deepEqual(decode((await runApplication(executeQuery(root, request, 'off'))).value), baseline);
    const index = decode(await runApplication(executeViewAction(root, { action: `${kind}.index` })));
    assert.deepEqual(index, { ...baseline, operation: `${kind}-index` });
    rmSync(join(root, otherPath));
    const path = kind === 'issue' ? 'docs/issues/broken.md' : 'memory/broken.md';
    writeFileSync(join(root, path), 'No heading\n');
    const partial = decode(await runApplication(executeViewAction(root, { action: `${kind}.index` })));
    assert.deepEqual(partial.documents, baseline.documents);
    assert.equal(partial.complete, false);
    assert.deepEqual(partial.findings.map(({ code, path }) => ({ code, path })), [{ code: 'InvalidData', path }]);
    if (kind === 'memory') assert.deepEqual(decode((await runApplication(executeQuery(root, { name: 'memory.index', input: {} }, 'off'))).value), partial);
    const search = await runApplication(executeQuery(root, { name: kind === 'issue' ? 'issue.search' : 'memory.search', input: { query: 'healthy' } }, 'off').pipe(Effect.result));
    assert.equal(search._tag, 'Failure');
    if (search._tag === 'Failure') assert.equal(search.failure.code, 'InvalidData');
    rmSync(join(root, path));
  }
}));

// @use-case docs/feature/document-packages/use-case/discover-managed-documents.md#partial-list
test('list retains hard failure for unsafe document paths', () => consumer(async root => {
  mkdirSync(join(root, 'docs/issues'), { recursive: true });
  symlinkSync(join(root, 'memory/healthy.md'), join(root, 'docs/issues/unsafe.md'));
  const result = await runApplication(executeQuery(root, { name: 'documents.list', input: { kind: 'issue' } }, 'off').pipe(Effect.result));
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') assert.equal(result.failure.code, 'UnsafePath');
}));
