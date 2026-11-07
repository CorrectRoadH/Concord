import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.ts';
import { digest } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

const Shown = Schema.Struct({ document: Schema.Struct({ path: Schema.String }) });
const Trace = Schema.Struct({ tests: Schema.Array(Schema.Unknown) });
const Check = Schema.Struct({ ok: Schema.Boolean });

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

async function query<A>(root: string, request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
  const reply = await runApplication(executeQuery(root, request, 'off'));
  assert.equal(reply.exitCode, status);
  return Schema.decodeUnknownSync(schema)(reply.value);
}

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('Unicode package paths retain identity through edits, discovery and trace', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'npc', title: 'NPC' })); }
  finally { repo.close(); }
  renameSync(join(root, 'docs/feature/npc'), join(root, 'docs/feature/角色目录'));
  const expectedPath = 'docs/feature/角色目录/use-case/扩展NPC动作.md';
  const input = { action: 'document.create', kind: 'use-case', id: '扩展NPC动作', feature: '角色目录', title: '扩展 NPC 动作' };
  const preview = await runApplication(executeViewAction(root, { ...input, dryRun: true }));
  assert.deepEqual(Schema.decodeUnknownSync(Schema.Struct({ changedPaths: Schema.Array(Schema.String) }))(preview).changedPaths, [expectedPath]);
  assert.equal(existsSync(join(root, expectedPath)), false);
  await runApplication(executeViewAction(root, input));
  write(root, 'docs/feature/角色目录/architecture/README.md', '# NPC 内部机制\n\n- [认知与执行](认知与执行.md)\n- [常识与上下文](常识与上下文.md)\n');
  for (const page of ['认知与执行', '常识与上下文']) {
    const path = `docs/feature/角色目录/architecture/${page}.md`;
    const before = `# ${page}\n`;
    write(root, path, before);
    await runApplication(executeViewAction(root, { action: 'document.set', path, body: `# ${page}\n\n中文正文。\n`, expectedDigest: digest(before) }));
    assert.match(readFileSync(join(root, path), 'utf8'), /中文正文/u);
  }
  assert.equal((await query(root, { name: 'documents.show', input: { id: '扩展NPC动作' } }, Shown)).document.path, expectedPath);
  write(root, 'test/unicode.test.ts', `// @use-case ${expectedPath}\n// @name 中文用例\n`);
  assert.equal((await query(root, { name: 'trace.show', input: { reference: expectedPath } }, Trace)).tests.length, 1);
  await runApplication(executeViewAction(root, { action: 'document.create', kind: 'use-case', id: 'internal-id', feature: '角色目录', title: '内部身份与文件名独立' }));
  const namedPath = 'docs/feature/角色目录/use-case/中文文件名.md';
  renameSync(join(root, 'docs/feature/角色目录/use-case/internal-id.md'), join(root, namedPath));
  assert.equal((await query(root, { name: 'documents.show', input: { id: '中文文件名' } }, Shown)).document.path, namedPath);
  write(root, 'test/named.test.ts', `// @use-case ${namedPath}\n`);
  assert.equal((await query(root, { name: 'check', input: {} }, Check)).ok, true);
  assert.equal((await query(root, { name: 'trace.check', input: {} }, Check)).ok, true);
  assert.equal((await query(root, { name: 'trace.show', input: { reference: namedPath } }, Trace)).tests.length, 1);
  await runApplication(executeQuery(root, { name: 'trace.gaps', input: {} }, 'off'));
  renameSync(join(root, namedPath), join(root, 'docs/feature/角色目录/中文文件名.md'));
  assert.equal((await query(root, { name: 'check', input: {} }, Check, 1)).ok, false);
  await assert.rejects(runApplication(executeViewAction(root, { action: 'document.set', path: '../越界.md', body: '# No\n', expectedDigest: 'sha256:unknown' })), { code: 'FileNotFound' });
  await assert.rejects(runApplication(executeViewAction(root, { action: 'document.create', kind: 'use-case', id: '坏/名称', feature: '角色目录', title: '坏名称' })), { code: 'InvalidData' });
});
