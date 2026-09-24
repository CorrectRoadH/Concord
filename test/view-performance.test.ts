import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { recoverPublicationLeaseSync } from '../dist/coordination.js';
import { createDocument } from '../dist/documents.js';
import { inspectDocumentFile, inspectDocuments, readSource, setMarkdown } from '../dist/editing.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer } from '../dist/view-server.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-view-performance-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [], sourceRoots: ['src'] });
    createDocument(repo, 'feature', { id: 'cached', title: 'Cached', pages: ['architecture'] });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.ts'), '// @concord-code\n// @concord-implements docs/feature/cached/README.md\nexport function cachedCode() { return true; }\n');
  return root;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('direct file reads preserve owner diagnostics and inspect only the target and ancestors', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  const repo = new LocalRepository(root);
  try {
    for (let index = 0; index < 120; index += 1) writeFileSync(join(root, `docs/feature/other-${index}.md`), '# Unrelated\n');
    mkdirSync(join(root, 'docs/feature/cached/nested'));
    const broken = 'docs/feature/cached/nested/README.md';
    writeFileSync(join(root, broken), '---\nformat: concord.document/v1\nkind: feature\n---\nBroken\n');
    writeFileSync(join(root, 'docs/feature/cached/nested/notes.md'), '# Notes\n');
    const inventory = inspectDocuments(repo);
    for (const page of inventory.pages) assert.deepEqual(inspectDocumentFile(repo, page.path), page);
    for (const document of inventory.documents) assert.deepEqual(inspectDocumentFile(repo, document.path), {
      path: document.path, body: document.body, digest: document.digest, readOnly: false, documentPath: document.path,
    });
    const reads: string[] = [];
    let walks = 0;
    const read = repo.read.bind(repo), files = repo.files.bind(repo);
    repo.read = path => { reads.push(path); return read(path); };
    repo.files = path => { walks += 1; return files(path); };
    inspectDocumentFile(repo, 'docs/feature/cached/architecture.md');
    assert.deepEqual(reads, ['docs/feature/cached/architecture.md', 'docs/feature/README.md', 'docs/feature/cached/README.md']);
    reads.length = 0;
    assert.match(readSource(repo, 'src/main.ts').body, /cachedCode/);
    assert.deepEqual(reads, ['src/main.ts']);
    assert.equal(walks, 0, 'selecting a file must not enumerate the repository');
    assert.equal(inspectDocumentFile(repo, 'README.md'), undefined);
    assert.equal(inspectDocumentFile(repo, 'docs/feature-other/private.md'), undefined);
    assert.throws(() => inspectDocumentFile(repo, 'docs/feature/../../README.md'), { code: 'UnsafePath' });
    symlinkSync(join(root, 'src/main.ts'), join(root, 'docs/feature/link.md'));
    assert.throws(() => inspectDocumentFile(repo, 'docs/feature/link.md'), { code: 'UnsafePath' });
    symlinkSync(join(root, 'src/main.ts'), join(root, 'src/link.ts'));
    assert.throws(() => readSource(repo, 'src/link.ts'), { code: 'UnsafePath' });
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('warm workspace caches observe changed bytes with unchanged timestamps and removed paths', async () => {
  const root = fixture();
  try {
    await Effect.runPromise(getWorkspaceSnapshot(root, 'use'));
    const warm = await Effect.runPromise(getWorkspaceSnapshot(root, 'use'));
    assert.ok(warm.cache && typeof warm.cache === 'object' && 'status' in warm.cache);
    assert.equal(warm.cache.status, 'hit');
    assert.equal(warm.documents.find(document => document.metadata.id === 'cached')?.metadata.title, 'Cached');
    assert.equal(warm.codes[0]?.symbol, 'cachedCode');
    assert.match(warm.codes[0]?.id ?? '', /^code-[0-9a-f]{32}$/u);
    const warmCodeId = warm.codes[0]?.id;
    for (const [path, before, after] of [
      ['docs/feature/cached/README.md', 'Cached', 'Edited'],
      ['src/main.ts', 'cachedCode', 'editedCode'],
    ] as const) {
      const absolute = join(root, path), stat = statSync(absolute);
      writeFileSync(absolute, readFileSync(absolute, 'utf8').replaceAll(before, after));
      utimesSync(absolute, stat.atime, stat.mtime);
    }
    const edited = await Effect.runPromise(getWorkspaceSnapshot(root, 'use'));
    assert.equal(edited.documents.find(document => document.metadata.id === 'cached')?.metadata.title, 'Edited');
    assert.equal(edited.codes[0]?.symbol, 'editedCode');
    assert.match(edited.codes[0]?.id ?? '', /^code-[0-9a-f]{32}$/u);
    assert.notEqual(edited.codes[0]?.id, warmCodeId);
    assert.equal(warm.documents.find(document => document.metadata.id === 'cached')?.metadata.title, 'Cached', 'cached objects do not alias earlier snapshots');
    rmSync(join(root, 'src/main.ts'));
    rmSync(join(root, 'docs/feature/cached/architecture.md'));
    const removed = await Effect.runPromise(getWorkspaceSnapshot(root, 'use'));
    assert.deepEqual(removed.codes, []);
    assert.deepEqual(removed.sources, []);
    assert.ok(!removed.pages.some(page => page.path === 'docs/feature/cached/architecture.md'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('unchanged workspace responses omit the payload and external edits invalidate their ETag', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    const url = `http://127.0.0.1:${server.port}/api/workspace`;
    await (await fetch(url)).arrayBuffer();
    const warm = await fetch(url);
    await warm.arrayBuffer();
    const etag = warm.headers.get('etag');
    assert.ok(etag);
    const unchanged = await fetch(url, { headers: { 'If-None-Match': etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');
    writeFileSync(join(root, 'docs/feature/cached/architecture.md'), '# External edit\n');
    const edited = await fetch(url, { headers: { 'If-None-Match': etag } });
    assert.equal(edited.status, 200);
    assert.notEqual(edited.headers.get('etag'), etag);
    assert.match(await edited.text(), /External edit/);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('workbench compresses workspace data and caches fingerprinted assets only', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const workspace = await fetch(`${base}/api/workspace`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(workspace.status, 200);
    assert.equal(workspace.headers.get('content-encoding'), 'gzip');
    assert.equal(workspace.headers.get('vary'), 'Accept-Encoding');
    assert.equal(workspace.headers.get('cache-control'), 'no-store');
    assert.equal((await workspace.json() as { ok: boolean }).ok, true);
    const uncompressed = await fetch(`${base}/api/workspace`, { headers: { 'Accept-Encoding': 'gzip;q=0' } });
    assert.equal(uncompressed.headers.get('content-encoding'), null);
    const asset = readdirSync('dist/web/assets').find(name => /^index-.+\.js$/u.test(name));
    assert.ok(asset);
    const script = await fetch(`${base}/assets/${asset}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-encoding'), 'gzip');
    assert.equal(script.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const index = await fetch(base);
    assert.equal(index.headers.get('cache-control'), 'no-store');
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('independent readers share a lease while publication still requires exclusivity', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { acquireTraceLeaseSync, releaseTraceLeaseSync } from './dist/coordination.js'; const lease=acquireTraceLeaseSync(process.argv[1], 'shared', 'read-test'); process.stdout.write('held'); process.stdin.resume(); process.stdin.once('end',()=>releaseTraceLeaseSync(lease,'read-test'));", root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(child.stdout!, 'data');
    const file = await fetch(`http://127.0.0.1:${server.port}/api/file?path=docs%2Ffeature%2Fcached%2FREADME.md`);
    assert.equal(file.status, 200);
    assert.match(await file.text(), /Cached/);
    const workspace = await fetch(`http://127.0.0.1:${server.port}/api/workspace`);
    assert.equal(workspace.status, 200);
    assert.throws(() => new LocalRepository(root), { code: 'RepositoryBusy' });
  } finally {
    const closed = once(child, 'close');
    child.stdin!.end();
    await closed;
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery preserves live readers and removes only dead shared owners', async () => {
  const root = fixture();
  const reader = new LocalRepository(root, { dryRun: true });
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { acquireTraceLeaseSync } from './dist/coordination.js'; acquireTraceLeaseSync(process.argv[1], 'shared', 'dead-reader'); process.stdout.write('held'); process.stdin.resume();", root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    reader.beginSnapshot();
    await once(child.stdout!, 'data');
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    assert.throws(() => recoverPublicationLeaseSync(root), /owner is still alive/);
    reader.endSnapshot();
    recoverPublicationLeaseSync(root);
    const writer = new LocalRepository(root);
    writer.snapshot(() => assert.ok(writer.read('concord.config.ts')));
    writer.close();
  } finally {
    reader.close();
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('supporting-page saves avoid inventory scans and preserve conflict and owner guards', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  const repo = new LocalRepository(root);
  try {
    for (let index = 0; index < 120; index += 1) writeFileSync(join(root, `docs/feature/other-${index}.md`), '# Unrelated\n');
    const path = 'docs/feature/cached/architecture.md';
    const page = inspectDocumentFile(repo, path)!;
    let walks = 0;
    const files = repo.files.bind(repo);
    repo.files = path => { walks += 1; return files(path); };
    setMarkdown(repo, path, '# Saved\n', page.digest);
    assert.equal(readFileSync(join(root, path), 'utf8'), '# Saved\n');
    assert.equal(walks, 0, 'saving one supporting page must not enumerate unrelated documents');
    assert.throws(() => setMarkdown(repo, path, '# Stale\n', page.digest), { code: 'PreimageChanged' });
    writeFileSync(join(root, 'docs/feature/cached/README.md'), '---\nformat: concord.document/v1\nkind: feature\n---\nBroken\n');
    assert.throws(() => setMarkdown(repo, path, '# Invalid\n', page.digest), { code: 'ReadOnlyDocument' });
    assert.equal(readFileSync(join(root, path), 'utf8'), '# Saved\n');
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('HTTP Git status does not scan workspace documents or source declarations', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const files = LocalRepository.prototype.files;
  let walks = 0;
  LocalRepository.prototype.files = function(path) { walks += 1; return files.call(this, path); };
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/git`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /src\/main.ts/);
    assert.equal(walks, 0, 'Git refresh must not compile the entire workspace');
  } finally {
    LocalRepository.prototype.files = files;
    await server.close(); rmSync(root, { recursive: true, force: true });
  }
});
