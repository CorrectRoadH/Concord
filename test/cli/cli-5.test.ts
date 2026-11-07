import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { readProjectConfig } from '../support/support.ts';
import { runCli } from '../support/cli.ts';
import { tmpdir } from '../support/temporary.ts';

async function call<A>(root: string, argv: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0, stdin?: string): Promise<A> {
  const result = await runCli({ argv: ['--root', root, '--json', '--fresh', ...argv], cwd: process.cwd(), env: process.env, stdin });
  assert.equal(result.exitCode, status, JSON.stringify(result));
  return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
}

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('feedback commands map provider, query and action arguments to JSON and named errors', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'issue', { id: 'observation', title: 'Local observation' })); }
  finally { repo.close(); }
  const ack = Schema.Struct({});
  await call(root, ['feedback', 'connection', 'add', '--id', 'github-main', '--provider', 'github', '--owner', 'example', '--repo', 'demo', '--credential-env', 'CONCORD_TEST_MISSING_TOKEN'], ack);
  await call(root, ['feedback', 'connection', 'add', '--id', 'linear-main', '--provider', 'linear', '--team', 'TEAM', '--credential-env', 'CONCORD_TEST_MISSING_LINEAR_KEY'], ack);
  assert.deepEqual((await readProjectConfig(root)).feedbackConnections?.map(connection => connection.provider), ['github', 'linear']);
  const Feedback = Schema.Struct({ feedback: Schema.Array(Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ id: Schema.String }) }) })) });
  const listed = await call(root, ['feedback', 'list', '--provider', 'local', '--triage', 'pending', '--query', 'LOCAL'], Feedback);
  assert.deepEqual(listed.feedback.map(item => item.document.metadata.id), ['observation']);
  const shown = await call(root, ['feedback', 'show', 'observation'], Schema.Struct({ operation: Schema.Literal('feedback-show') }));
  assert.equal(shown.operation, 'feedback-show');
  const acted = await call(root, ['action', '--input', '-'], Feedback, 0, JSON.stringify({ action: 'feedback.list', provider: 'local', triage: 'pending' }));
  assert.deepEqual(acted.feedback.map(item => item.document.metadata.id), ['observation']);
  await call(root, ['action', '--input', '-'], Schema.Struct({ error: Schema.String }), 1, JSON.stringify({ action: 'feedback.list', state: 'draft' }));
  await call(root, ['feedback', 'connection', 'remove', 'github-main'], ack);
  assert.deepEqual((await readProjectConfig(root)).feedbackConnections?.map(connection => connection.id), ['linear-main']);
});

const scratch = mkdtempSync(join(tmpdir(), 'concord-export-mapping-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('view export maps revision and output arguments to its JSON receipt and error', async () => {
  const root = (await createConsumer());
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'readme.md'), '# Before\n');
  git('add', '.'); git('commit', '-qm', 'Before');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'readme.md'), '# After\n');
  git('add', '.'); git('commit', '-qm', 'After');
  const head = git('rev-parse', 'HEAD');
  const out = join(scratch, 'preview');
  const argv = ['view', 'export', '--base', base, '--head', head, '--out', out];
  const receipt = await call(root, argv, Schema.Struct({ operation: Schema.String, output: Schema.String, files: Schema.Int, comparison: Schema.Struct({ base: Schema.String, head: Schema.String }) }));
  assert.equal(receipt.operation, 'view-export');
  assert.equal(receipt.output, out);
  assert.equal(receipt.files, 1);
  assert.deepEqual(receipt.comparison, { base, head });
  const sentinel = join(out, 'keep');
  writeFileSync(sentinel, 'unknown');
  const failure = await call(root, argv, Schema.Struct({ error: Schema.String }), 1);
  assert.equal(failure.error, 'PreviewOutputExists');
  assert.equal(readFileSync(sentinel, 'utf8'), 'unknown');
});
