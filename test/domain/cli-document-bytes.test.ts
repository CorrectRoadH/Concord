import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { executeQuery, executeViewAction } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

const Receipt = Schema.Struct({ digest: Schema.String });
const Catalogs = Schema.Struct({ catalogs: Schema.Array(Schema.Struct({ path: Schema.String })), diagnostics: Schema.Array(Schema.Unknown) });
const Cases = Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) });
const Trace = Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) });
const Check = Schema.Struct({ ok: Schema.Boolean });

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('concepts actions preserve Markdown bytes and reject a stale whole-file save', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'catalog', title: 'Catalog' })); }
  finally { repo.close(); }
  const path = 'docs/feature/catalog/concepts.md';
  const source = '# Terms\r\n\r\n## Memory {#memory}\r\n\r\nA durable finding.\r\n\r\n<!-- Author spacing -->\r\n';
  const save = async (body: string, expectedDigest: string | null) => Schema.decodeUnknownSync(Receipt)(await runApplication(executeViewAction(root, { action: 'document.set', path, body, expectedDigest })));
  const created = await save(source, null);
  assert.equal(readFileSync(join(root, path), 'utf8'), source);
  const saved = await save(`${source}\r\n`, created.digest);
  await assert.rejects(save(source, created.digest), { code: 'FileChangedSinceRead' });
  await save(source, saved.digest);
  assert.equal(readFileSync(join(root, path), 'utf8'), source);
  mkdirSync(join(root, 'docs/ignored'), { recursive: true });
  writeFileSync(join(root, 'docs/ignored/concepts.json'), 'not parsed or reported');
  const reply = await runApplication(executeQuery(root, { name: 'concepts.index', input: {} }, 'off'));
  assert.equal(reply.exitCode, 0);
  const index = Schema.decodeUnknownSync(Catalogs)(reply.value);
  assert.ok(index.catalogs.every(item => item.path.endsWith('/concepts.md')));
  assert.equal(index.diagnostics.length, 0);
});

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('a configless neutral consumer supports static checks and trace', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'feature', { id: 'static', title: 'Static contract' }));
    (await createDocument(repo, 'issue', { id: 'missing-runner', title: 'Missing runner' }));
  } finally { repo.close(); }
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/static.test.ts'), '// @feature docs/feature/static/README.md\n// @issue docs/issues/missing-runner.md\n');
  rmSync(join(root, 'concord.config.ts'), { force: true });
  const listed = await runApplication(executeQuery(root, { name: 'test.list', input: {} }, 'off'));
  const cases = Schema.decodeUnknownSync(Cases)(listed.value).cases;
  assert.equal(cases.length, 1);
  const traced = await runApplication(executeQuery(root, { name: 'trace.show', input: { reference: 'static' } }, 'off'));
  assert.deepEqual(Schema.decodeUnknownSync(Trace)(traced.value).tests.map(item => item.id), [cases[0]!.id]);
  const checked = await runApplication(executeQuery(root, { name: 'check', input: {} }, 'off'));
  assert.equal(checked.exitCode, 0);
  assert.equal(Schema.decodeUnknownSync(Check)(checked.value).ok, true);
});
