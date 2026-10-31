import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { parseDocumentRecord } from '../../src/domain/documents/index.js';
import { renderDocument } from '../../src/model/index.js';
import { activateMemory, linkIssue } from '../../src/app/index.js';
import { LocalRepository } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';
import { createDocument } from '../support/operations.js';
import { installedConcordCli } from '../support/support.js';

const cli = installedConcordCli();
const Result = Schema.Struct({ operation: Schema.optional(Schema.String), error: Schema.optional(Schema.String), documents: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, body: Schema.optional(Schema.String), provider: Schema.optional(Schema.String) }))) });
function call(root: string, args: readonly string[], status = 0, input = '') {
  const run = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { input, encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, status, JSON.stringify({ args, stdout: run.stdout, stderr: run.stderr }));
  return Schema.decodeUnknownSync(Schema.fromJsonString(Result), { onExcessProperty: 'ignore' })(status === 0 || run.stdout.trim() ? run.stdout : run.stderr);
}
function consumer(_name: string): string { return createConsumer(); }
function digestFor(root: string, path: string): string {
  const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'));
  assert.ok(record);
  return record.digest;
}

function saveBody(root: string, path: string, body: string, expectedDigest: string, status = 0) {
  const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'))!;
  return call(root, ['action', '--input', '-'], status, JSON.stringify({ action: 'document.set', path, body: renderDocument(record.metadata, body), expectedDigest }));
}

function run(root: string, args: readonly string[], input = '') {
  return spawnSync(process.execPath, [cli, '--root', root, ...args], { input, encoding: 'utf8', timeout: 20_000 });
}

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed CLI parse errors preserve the input diagnostic and help remains successful', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('parse-errors');
  const missing = run(root, ['--json', 'new', 'memory', 'x', '--title', 't']);
  assert.equal(missing.status, 1);
  const ErrorResult = Schema.Struct({ ok: Schema.Boolean, error: Schema.String, message: Schema.String });
  const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorResult))(missing.stderr);
  assert.equal(parsed.error, 'InvalidInput');
  assert.match(parsed.message, /requires --type/u);
  for (const args of [['--json', 'new', 'memory', 'x', '--title', 't', '--type', 'bogus'], ['--json', 'memory', 'recall'], ['--json', '--unknown-flag']]) {
    const result = run(root, args);
    assert.equal(result.status, 1, JSON.stringify(result));
    const error = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorResult))(result.stderr);
    assert.equal(error.error, 'InvalidInput');
    assert.doesNotMatch(error.message, /Help requested/u);
  }
  const help = run(root, ['new', 'memory', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /USAGE/u);
  assert.doesNotMatch(help.stderr, /InvalidInput|OperationFailed/u);
})));

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed knowledge commands preserve named failures, exits and body excerpts', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('boundary');
  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'memory', { id: 'cache', title: 'HawDB cache', memoryKind: 'note', body: '# Cache\n\nHawDB stores disposable projections.\n' });
    createDocument(repo, 'memory', { id: 'linked-memory', title: 'Linked memory', memoryKind: 'decision' });
    activateMemory(repo, 'linked-memory', 'Adopt');
    createDocument(repo, 'issue', { id: 'linked', title: 'Linked' });
    linkIssue(repo, 'linked', 'memory/linked-memory.md');
    createDocument(repo, 'issue', { id: 'probe', title: 'HawDB observation', body: 'The HawDB cache has a symptom.\n' });
  } finally { repo.close(); }
  assert.equal(call(root, ['memory', 'index']).documents?.[0]?.digest, digestFor(root, 'memory/cache.md'));
  const human = run(root, ['memory', 'recall', 'HAWDB projections']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /memory\/cache\.md — Cache/u);
  assert.match(human.stdout, /note: captured/u);
  assert.match(human.stdout, /HawDB stores disposable projections/u);
  const issueRecall = run(root, ['issue', 'recall', 'cache hawdb']);
  assert.equal(issueRecall.status, 0, issueRecall.stderr);
  assert.match(issueRecall.stdout, /HawDB observation[\s\S]*issue: open[\s\S]*HawDB cache has a symptom/u);
  assert.equal(call(root, ['memory', 'recall', ' \t '], 1).error, 'InvalidInput');
  assert.equal(call(root, ['issue', 'recall', '  '], 1).error, 'InvalidInput');
  assert.equal(saveBody(root, 'memory/cache.md', 'stale\n', 'missing-digest', 1).error, 'PreimageChanged');
  assert.equal(call(root, ['action', '--input', '-'], 1, JSON.stringify({ action: 'issue.remove', id: 'linked', expectedDigest: digestFor(root, 'docs/issues/linked.md') })).error, 'IssueNotRemovable');
  assert.equal(call(root, ['recover']).operation, 'recover');
})));
