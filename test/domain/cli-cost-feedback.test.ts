import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { parseDocumentRecord } from '../../src/domain/documents/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { runApplication } from '../support/repository.ts';
import { writeProjectConfig, readProjectConfig } from '../support/support.ts';

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('local feedback preserves connection configuration, triage filters and Issue lifecycle', async () => {
  const root = (await createConsumer());
  writeProjectConfig(root, { feedbackConnections: [
    { id: 'github-main', provider: 'github', transport: 'api', owner: 'example', repo: 'demo', credentialEnv: 'CONCORD_TEST_MISSING_TOKEN' },
    { id: 'linear-main', provider: 'linear', team: 'TEAM', credentialEnv: 'CONCORD_TEST_MISSING_LINEAR_KEY' },
  ] });
  assert.deepEqual((await readProjectConfig(root)).feedbackConnections?.map(connection => connection.provider), ['github', 'linear']);
  const action = (input: unknown) => runApplication(executeViewAction(root, input));
  async function query<A>(request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>) {
    const reply = await runApplication(executeQuery(root, request));
    assert.equal(reply.exitCode, 0);
    return Schema.decodeUnknownSync(schema)(reply.value);
  }
  await action({ action: 'document.create', kind: 'feature', id: 'feedback-target', title: 'Feedback target' });
  await action({ action: 'document.create', kind: 'issue', id: 'observation', title: 'Local observation' });
  await action({ action: 'issue.link', id: 'observation', role: 'spec', memory: 'docs/feature/feedback-target/README.md' });
  const relative = 'docs/issues/observation.md';
  const linked = parseDocumentRecord(relative, readFileSync(join(root, relative), 'utf8'), makeRuntimeEnvironment(process.cwd(), process.env));
  assert.equal(linked?.metadata.kind, 'issue');
  if (linked?.metadata.kind !== 'issue') assert.fail('feedback must retain the local issue owner');
  assert.deepEqual(linked.metadata.relations.filter(relation => relation.role === 'spec').map(relation => relation.target), ['docs/feature/feedback-target/README.md']);
  assert.equal(linked.metadata.source, undefined);
  assert.match(JSON.stringify(await query({ name: 'feedback.list', input: {} }, Schema.Unknown)), /observation/);
  await query({ name: 'feedback.show', input: { id: 'observation' } }, Schema.Unknown);
  await action({ action: 'document.create', kind: 'issue', id: 'pending', title: 'Pending observation' });
  const Feedback = Schema.Struct({ feedback: Schema.Array(Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ id: Schema.String }) }) })) });
  const Issues = Schema.Struct({ drafts: Schema.Array(Schema.Struct({ metadata: Schema.Struct({ id: Schema.String }) })) });
  for (const [filter, expected] of [
    [{ provider: 'local', triage: 'linked', query: 'LOCAL' }, ['observation']],
    [{ triage: 'pending' }, ['pending']],
    [{ provider: 'github' }, []],
  ] as const) {
    const listed = await query({ name: 'feedback.list', input: { filter } }, Feedback);
    assert.deepEqual(listed.feedback.map(item => item.document.metadata.id), expected);
  }
  const feedback = Schema.decodeUnknownSync(Feedback)(await action({ action: 'feedback.list', provider: 'local', triage: 'pending' }));
  assert.deepEqual(feedback.feedback.map(item => item.document.metadata.id), ['pending']);
  const issues = Schema.decodeUnknownSync(Issues)(await action({ action: 'issue.list', query: 'Local observation' }));
  assert.deepEqual(issues.drafts.map(item => item.metadata.id), ['observation']);
  await assert.rejects(action({ action: 'feedback.list', state: 'draft' }));
  const config = (await readProjectConfig(root));
  const shown = await query({ name: 'config.show', input: {} }, Schema.Struct({ digest: Schema.String }));
  await action({ action: 'config.set', config: { ...config, feedbackConnections: config.feedbackConnections?.filter(connection => connection.id !== 'github-main') }, expectedDigest: shown.digest });
  assert.ok(existsSync(join(root, relative)), 'removing a connection must preserve local observations');
  await action({ action: 'issue.close', id: 'observation', reason: 'Investigation complete' });
  assert.equal(existsSync(join(root, relative)), false);
  const listed = await query({ name: 'feedback.list', input: { filter: { provider: 'local' } } }, Feedback);
  assert.deepEqual(listed.feedback.map(item => item.document.metadata.id), ['pending']);
  assert.equal((await query({ name: 'check', input: {} }, Schema.Struct({ ok: Schema.Boolean }))).ok, true);
});
