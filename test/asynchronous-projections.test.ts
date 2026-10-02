import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, initialize } from '../dist/storage.js';
import { createDocument, setAuthor } from '../dist/documents.js';
import { ConcordError, digest } from '../dist/shared.js';
import { queryContext, readQuery, storeQuery } from '../dist/query-cache.js';

function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-async-projections-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: ['src'] }); createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); }
  finally { repo.close(); }
  return root;
}
const cli = resolve('dist/entry.js');
const call = (root: string, ...args: string[]) => spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 20_000 });
async function historicalCall(root: string) {
  const deadline = Date.now() + 10_000;
  while (true) {
    const result = call(root, 'trace', 'gaps');
    if (result.status === 0 || Date.now() >= deadline) return result;
    assert.equal(JSON.parse(result.stderr).error, 'HawdbBusy', result.stderr);
    await Effect.runPromise(Effect.sleep('100 millis'));
  }
}

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('failed refresh retains a full oldest snapshot at namespace capacity and success clears its error', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const context = queryContext(root, ['trace', 'gaps']);
    storeQuery(context, { original: true });
    for (let i = 0; i < 63; i++) storeQuery({ ...context, key: `other-${i}` }, { i });
    storeQuery(context, null, new ConcordError('QueryRefreshFailed', 'failed scan'));
    const failed = readQuery(context);
    assert.deepEqual(failed.record?.value, { original: true });
    assert.equal(failed.error?.code, 'QueryRefreshFailed');
    storeQuery(context, { refreshed: true });
    const succeeded = readQuery(context);
    assert.deepEqual(succeeded.record?.value, { refreshed: true });
    assert.equal(succeeded.error, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('a newly stored snapshot from an older scan does not consume a later refresh request', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const context = queryContext(root, ['trace', 'gaps']);
    const requestedAt = Date.now() - 100;
    storeQuery(context, { obsolete: true }, undefined, requestedAt - 1000);
    const result = spawnSync(process.execPath, [resolve('dist/query-refresh-worker.js'), root, JSON.stringify(context.query), String(requestedAt)], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const refreshed = readQuery(context);
    assert.ok(refreshed.record && refreshed.record.scannedAt >= requestedAt, JSON.stringify(refreshed));
    assert.notDeepEqual(refreshed.record.value, { obsolete: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('directory observations detect a size change even when an oversized file was not read', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'large.ts'), 'x'.repeat(1024 * 1024 + 1));
  const reader = new LocalRepository(root, { access: 'read' });
  try {
    reader.beginSnapshot(); reader.files('src');
    writeFileSync(join(root, 'src', 'large.ts'), '// @feature docs/feature/sample/README.md\n');
    assert.throws(() => reader.verifySnapshot(), { code: 'PreimageChanged' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('source reads do not own a lease and detect a concurrent successful publication', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const reader = new LocalRepository(root, { access: 'read' });
  try {
    reader.beginSnapshot();
    const path = 'docs/feature/sample/README.md';
    const before = reader.read(path)!;
    assert.equal(existsSync(join(root, '.git/concord/trace/publication.lease')), false);
    const writer = new LocalRepository(root, { optimistic: true });
    try { setAuthor(writer, path, '# Changed\n', digest(before)); }
    finally { writer.close(); }
    assert.match(readFileSync(join(root, path), 'utf8'), /Changed/);
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('concurrent optimistic plans reject the losing writer without overwriting the winner', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const first = new LocalRepository(root, { optimistic: true });
  const second = new LocalRepository(root, { optimistic: true });
  const path = 'docs/feature/sample/README.md';
  try {
    first.beginSnapshot(); second.beginSnapshot();
    const before = first.read(path)!; second.read(path);
    setAuthor(first, path, '# First\n', digest(before));
    assert.throws(() => setAuthor(second, path, '# Second\n', digest(before)), { code: 'PreimageChanged' });
    assert.match(readFileSync(join(root, path), 'utf8'), /First/);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a complete A-B-A publication is detected before the writer releases ownership', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const writer = new LocalRepository(root);
  const reader = new LocalRepository(root, { access: 'read' });
  const path = 'docs/feature/sample/README.md';
  try {
    writer.beginSnapshot();
    reader.beginSnapshot();
    const before = reader.read(path)!;
    writer.publish('test-edit', [{ path, before, after: `${before}\nchanged\n` }]);
    writer.publish('test-edit', [{ path, before: `${before}\nchanged\n`, after: before }]);
    assert.equal(readFileSync(join(root, path), 'utf8'), before);
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
    assert.ok(existsSync(join(root, '.git/concord/trace/publication.lease')));
  } finally { reader.close(); writer.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('CLI exits before refresh, serves a historical snapshot, and keeps fresh checks authoritative', async () => {
  const root = consumer();
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < 1072; i++) writeFileSync(join(root, 'src', `${i}.ts`), `export const value${i} = ${i};\n`);
  const context = queryContext(root, ['trace', 'gaps']);
  try {
    const cold = call(root, 'trace', 'gaps');
    assert.equal(cold.status, 1, cold.stderr);
    assert.match(cold.stderr, /QueryPending/);
    const deadline = Date.now() + 30_000;
    let cached = readQuery(context);
    while (!cached.record && Date.now() < deadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      cached = readQuery(context);
    }
    assert.ok(cached.record, JSON.stringify(cached));
    for (let i = 0; i < 4; i++) {
      const hit = await historicalCall(root);
      assert.equal(hit.status, 0, `Background source scanning must leave query projections readable: ${hit.stderr}`);
      assert.equal(JSON.parse(hit.stdout).projection.current, false);
    }
    const path = join(root, 'docs/feature/sample/README.md');
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    const historical = await historicalCall(root);
    assert.equal(historical.status, 0, historical.stderr);
    assert.equal(JSON.parse(historical.stdout).projection.current, false);
    const check = call(root, 'check');
    assert.equal(check.status, 1, check.stdout + check.stderr);
    assert.equal(JSON.parse(check.stdout).ok, false);
    const fresh = call(root, '--fresh', 'trace', 'gaps');
    assert.equal(fresh.status, 1, fresh.stdout + fresh.stderr);
    assert.match(fresh.stderr, /TraceInvalid/);
    const failedDeadline = Date.now() + 30_000;
    let failed = readQuery(context);
    while (!failed.error && Date.now() < failedDeadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      failed = readQuery(context);
    }
    assert.ok(failed.error, JSON.stringify(failed));
    assert.deepEqual(failed.record?.value, cached.record.value, 'failed refresh retains the complete prior diagnostic content');
    writeFileSync(path, source);
    // Let the bounded background request relinquish its cache handle before cleanup.
    await Effect.runPromise(Effect.sleep('2 seconds'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
