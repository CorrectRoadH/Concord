import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { Effect, Schema } from 'effect';
import { parseDocumentRecord, renderDocument } from '../dist/documents.js';
import { LocalRepository } from '../dist/storage.js';
import { digest } from '../dist/shared.js';
import { setConfig, showConfig } from '../dist/editing.js';

const scratch = mkdtempSync(join(tmpdir(), 'concord-knowledge-packed-'));
let cli: string;
before(() => Effect.runPromise(Effect.sync(() => {
  const packed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ filename: Schema.String }))))(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 }),
  );
  assert.ok(packed[0]);
  const install = join(scratch, 'tool');
  mkdirSync(install);
  writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, packed[0].filename)], { cwd: install, encoding: 'utf8', timeout: 60_000 });
  cli = join(install, 'node_modules/concord-sdlc/dist/entry.js');
})));
after(() => Effect.runPromise(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));

const Result = Schema.Struct({ operation: Schema.optional(Schema.String), error: Schema.optional(Schema.String), documents: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, body: Schema.optional(Schema.String), provider: Schema.optional(Schema.String) }))) });
function call(root: string, args: readonly string[], status = 0, input = '') {
  const run = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { input, encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, status, JSON.stringify({ args, stdout: run.stdout, stderr: run.stderr }));
  return Schema.decodeUnknownSync(Schema.fromJsonString(Result), { onExcessProperty: 'ignore' })(status === 0 || run.stdout.trim() ? run.stdout : run.stderr);
}
function consumer(name: string): string {
  const root = join(scratch, name);
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  call(root, ['init']);
  return root;
}
function digestFor(root: string, path: string): string {
  const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'));
  assert.ok(record);
  return record.digest;
}

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed Memory index and recall return current owner text and digest; edit enforces CAS', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('memory');
  call(root, ['memory', 'add', 'case-note', '--title', 'Case note', '--kind', 'note', '--body', '-'], 0, '# Initial\n\nNeedle in the body.\n');
  const path = 'memory/case-note.md';
  const first = digestFor(root, path);
  assert.equal(call(root, ['memory', 'index']).documents?.[0]?.digest, first);
  assert.equal(call(root, ['memory', 'recall', 'needle']).documents?.[0]?.body, '# Initial\n\nNeedle in the body.\n');
  call(root, ['memory', 'edit', 'case-note', '--body', '-', '--expected-digest', first], 0, '# Updated\n\nAnother term.\n');
  assert.equal(call(root, ['memory', 'recall', 'another']).documents?.[0]?.digest, digestFor(root, path));
  assert.deepEqual(call(root, ['memory', 'recall', 'needle']).documents, []);
  assert.equal(call(root, ['memory', 'edit', 'case-note', '--body', '-', '--expected-digest', first], 1, 'stale\n').error, 'PreimageChanged');

  const repo = new LocalRepository(root);
  try {
    const current = showConfig(repo);
    setConfig(repo, { ...current.config, memorySources: [...current.config.memorySources!, { name: 'archive', provider: 'local-files', path: 'archive-memory', access: 'read-only' }] }, current.digest);
  } finally { repo.close(); }
  mkdirSync(join(root, 'archive-memory'));
  const archived = 'archive-memory/case-note.md';
  writeFileSync(join(root, archived), readFileSync(join(root, path)));
  rmSync(join(root, path));
  assert.equal(call(root, ['memory', 'edit', archived, '--body', '-', '--expected-digest', digestFor(root, archived)], 1, 'denied\n').error, 'ReadOnlyMemorySource');
})));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('packed Issue workflow needs no provider, and deletion preserves linked or historical evidence', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('issue');
  call(root, ['issue', 'create', 'draft-one', '--title', 'Local observation', '--body', '-'], 0, 'A local symptom.\n');
  const path = 'docs/issues/draft-one.md';
  const first = digestFor(root, path);
  assert.equal(call(root, ['issue', 'index']).documents?.[0]?.provider, 'local');
  assert.equal(call(root, ['issue', 'recall', 'symptom']).documents?.[0]?.body, 'A local symptom.\n');
  call(root, ['issue', 'edit', 'draft-one', '--body', '-', '--expected-digest', first], 0, 'Updated symptom.\n');
  const current = digestFor(root, path);
  assert.equal(call(root, ['issue', 'remove', 'draft-one', '--expected-digest', first], 1).error, 'PreimageChanged');
  call(root, ['--dry-run', 'issue', 'remove', 'draft-one', '--expected-digest', current]);
  assert.equal(existsSync(join(root, path)), true);
  call(root, ['issue', 'remove', 'draft-one', '--expected-digest', current]);
  assert.equal(existsSync(join(root, path)), false);

  call(root, ['issue', 'draft', 'linked', '--title', 'Linked observation']);
  call(root, ['memory', 'add', 'linked-memory', '--title', 'Linked memory', '--kind', 'note']);
  call(root, ['issue', 'link', 'linked', '--memory', 'memory/linked-memory.md']);
  const linked = 'docs/issues/linked.md';
  assert.equal(call(root, ['issue', 'remove', 'linked', '--expected-digest', digestFor(root, linked)], 1).error, 'IssueNotRemovable');

  call(root, ['issue', 'create', 'historical', '--title', 'Historical']);
  const historical = 'docs/issues/historical.md';
  const parsed = parseDocumentRecord(historical, readFileSync(join(root, historical), 'utf8'));
  assert.ok(parsed && parsed.metadata.kind === 'issue');
  writeFileSync(join(root, historical), renderDocument({ ...parsed.metadata, history: [{ at: '2026-09-23T00:00:00Z', action: 'observed', reason: 'Retain' }] }, parsed.body));
  assert.equal(call(root, ['issue', 'remove', 'historical', '--expected-digest', digestFor(root, historical)], 1).error, 'IssueNotRemovable');

  call(root, ['issue', 'create', 'sourced', '--title', 'Sourced']);
  const sourced = 'docs/issues/sourced.md';
  const remote = parseDocumentRecord(sourced, readFileSync(join(root, sourced), 'utf8'));
  assert.ok(remote && remote.metadata.kind === 'issue');
  writeFileSync(join(root, sourced), renderDocument({ ...remote.metadata, source: {
    provider: 'github', instance: 'https://api.github.com', id: '123', url: 'https://github.com/example/demo/issues/123',
    title: 'Remote title', body: 'Remote body', state: 'open', updatedAt: '2026-09-23T00:00:00Z', connectionId: 'external', importedAt: '2026-09-23T00:00:00Z',
  } }, remote.body));
  assert.equal(call(root, ['issue', 'index']).documents?.find(item => item.path === sourced)?.provider, 'github');
  assert.equal(call(root, ['issue', 'remove', 'sourced', '--expected-digest', digestFor(root, sourced)], 1).error, 'IssueNotRemovable');

  call(root, ['issue', 'create', 'canonical', '--title', 'Canonical', '--body', '-'], 0, '# Anchor heading\n\nOriginal report.\n');
  call(root, ['issue', 'create', 'duplicate', '--title', 'Duplicate']);
  const duplicate = 'docs/issues/duplicate.md';
  const referring = parseDocumentRecord(duplicate, readFileSync(join(root, duplicate), 'utf8'));
  assert.ok(referring && referring.metadata.kind === 'issue');
  writeFileSync(join(root, duplicate), renderDocument({ ...referring.metadata, state: 'closed', closure: { kind: 'duplicate', canonical: 'docs/issues/canonical.md#anchor-heading' } }, referring.body));
  assert.equal(call(root, ['issue', 'remove', 'canonical', '--expected-digest', digestFor(root, 'docs/issues/canonical.md')], 1).error, 'IssueNotRemovable');
})));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('packed recover rolls back prepared Issue deletion, preserves committed deletion, and rejects unknown edits', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('recovery');
  const path = 'docs/issues/recoverable.md';
  const journalPath = join(root, '.git/concord/journal.json');
  call(root, ['issue', 'create', 'recoverable', '--title', 'Recoverable']);
  const before = readFileSync(join(root, path), 'utf8');
  const repo = new LocalRepository(root);
  const common = {
    format: 'concord.journal', root, privateDir: repo.privateDir, projectId: repo.config.projectId,
    operation: 'remove-issue', directories: [],
    scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
    changes: [{ path, before, after: null, beforeDigest: digest(before), afterDigest: null, mode: 420 }],
  };
  repo.close();
  rmSync(join(root, path));
  writeFileSync(journalPath, `${JSON.stringify({ ...common, phase: 'prepared' })}\n`);
  assert.equal(call(root, ['recover']).operation, 'recover');
  assert.equal(readFileSync(join(root, path), 'utf8'), before);

  rmSync(join(root, path));
  writeFileSync(journalPath, `${JSON.stringify({ ...common, phase: 'committed' })}\n`);
  call(root, ['recover']);
  assert.equal(existsSync(join(root, path)), false);

  writeFileSync(join(root, path), before);
  writeFileSync(journalPath, `${JSON.stringify({ ...common, phase: 'prepared' })}\n`);
  writeFileSync(join(root, path), 'unknown edit\n');
  assert.equal(call(root, ['recover'], 1).error, 'RecoveryConflict');
  assert.equal(readFileSync(join(root, path), 'utf8'), 'unknown edit\n');
  assert.equal(existsSync(journalPath), true);
})));
