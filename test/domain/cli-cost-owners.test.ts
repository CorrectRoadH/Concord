import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { executeQuery, executeViewAction } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { runApplication } from '../support/repository.ts';

const Config = Schema.Struct({ config: Schema.Record(Schema.String, Schema.Unknown), digest: Schema.String });
const Documents = Schema.Struct({ documents: Schema.Array(Schema.Unknown) });
const action = (root: string, input: unknown) => runApplication(executeViewAction(root, input));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('configuration writes reject retired fields and stale digests without changing bytes', async () => {
  const root = (await createConsumer());
  const current = Schema.decodeUnknownSync(Config)((await runApplication(executeQuery(root, { name: 'config.show', input: {} }))).value);
  assert.deepEqual(current.config, {});
  await action(root, { action: 'config.set', config: { testRoots: [] }, expectedDigest: current.digest });
  const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
  assert.doesNotMatch(source, /projectId|concord.project|memorySources/u);
  await assert.rejects(action(root, { action: 'config.set', config: {}, expectedDigest: current.digest }), { code: 'FileChangedSinceRead' });
  const next = Schema.decodeUnknownSync(Config)((await runApplication(executeQuery(root, { name: 'config.show', input: {} }))).value);
  await assert.rejects(action(root, { action: 'config.set', config: { projectId: 'legacy' }, expectedDigest: next.digest }), { code: 'InvalidData' });
  assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
});

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('owner relation helpers persist only current owner fields', async () => {
  const root = (await createConsumer());
  for (const [kind, id, extra] of [
    ['feature', 'cart', {}], ['use-case', 'add', { feature: 'cart' }], ['memory', 'choice', {}],
  ] as const) await action(root, { action: 'document.create', kind, id, title: id, ...extra });
  await action(root, { action: 'memory.link', id: 'choice', target: 'docs/feature/cart/README.md', role: 'supports' });
  await action(root, { action: 'document.create', kind: 'issue', id: 'bug', title: 'bug' });
  for (const [memory, role] of [['memory/choice.md', 'investigation'], ['docs/feature/cart/README.md', 'spec']] as const) {
    await action(root, { action: 'issue.link', id: 'bug', memory, role });
    await action(root, { action: 'issue.unlink', id: 'bug', memory, role });
  }
  assert.match(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /role: supports/u);
  assert.doesNotMatch(readFileSync(join(root, 'docs/issues/bug.md'), 'utf8'), /relations:|history:|format:|draft/u);
  const listed = await runApplication(executeQuery(root, { name: 'documents.list', input: { kind: 'issue' } }));
  assert.equal(Schema.decodeUnknownSync(Documents)(listed.value).documents.length, 1);
});

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Design creation produces one directly editable tradeoff page', async () => {
  const root = (await createConsumer());
  await action(root, { action: 'document.create', kind: 'design', id: 'storage', title: 'storage' });
  assert.equal(existsSync(join(root, 'docs/design/storage.md')), true);
  assert.equal(existsSync(join(root, 'docs/design/storage')), false);
});
