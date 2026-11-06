// 跨进程保证：网络——真实HTTP投影刷新后ETag失效且后续304复用已发布generation。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { installationResources } from "../../src/base/installation/index.ts";
import { installedConcordCli } from "../support/support.ts";
import { dirname } from "node:path";
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from "../../src/app/index.ts";
import { recoverPublicationLeaseSync } from "../../src/base/publication/index.ts";

import { inspectDocumentFile, inspectDocuments, readSource, setMarkdown } from "../../src/app/index.ts";
import { LocalRepository } from "../support/repository.ts";
import { openHawdb } from '../../src/base/cache/index.ts';

import { startViewServer } from '../e2e/server.ts';
import { parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

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
test('HTTP projection retains orphan annotation incompleteness and observes its repair', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const path = join(root, 'src/main.ts');
  const original = readFileSync(path, 'utf8');
  const requestRefresh = () => fetchFresh(`${base}/api/workspace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const waitForFinding = (code: string) => pollUntil(async () => {
    const response = await fetchFresh(`${base}/api/workspace`);
    if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
    const value = parseWorkspaceProjection(await response.text());
    if (value === undefined) return undefined;
    return value.snapshot.findings.some(item => item.code === code) ? value : undefined;
  }, { description: `workspace generation with ${code}`, timeoutMs: 45_000 });
  try {
    await waitForWorkspaceProjection(base);
    writeFileSync(path, `${original}\n// @concord-file\n// @concord-implements docs/feature/cached/README.md\n`);
    await requestRefresh();
    const orphaned = await waitForFinding('OrphanCodeAnnotation');
    assert.equal(orphaned.projection.complete, false);
    writeFileSync(path, original);
    await requestRefresh();
    const healthy = await pollUntil(async () => {
      const response = await fetchFresh(`${base}/api/workspace`);
      if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
      const value = parseWorkspaceProjection(await response.text());
      return value !== undefined && value.snapshot.complete === true && value.projection.builtAt !== orphaned.projection.builtAt ? value : undefined;
    }, { description: 'repaired workspace generation', timeoutMs: 45_000 });
    assert.deepEqual(healthy.snapshot.findings, []);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('direct file reads preserve owner diagnostics and inspect only the target and ancestors', () => runApplication(Effect.sync(() => {
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
      path: document.path, body: document.body, digest: document.digest, documentPath: document.path, document,
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
    openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: true }, nativeRuntime).close();
    await runApplication(getWorkspaceSnapshot(root, 'use'));
    const warm = await runApplication(getWorkspaceSnapshot(root, 'use'));
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
    const edited = await runApplication(getWorkspaceSnapshot(root, 'use'));
    assert.equal(edited.documents.find(document => document.metadata.id === 'cached')?.metadata.title, 'Edited');
    assert.equal(edited.codes[0]?.symbol, 'editedCode');
    assert.match(edited.codes[0]?.id ?? '', /^code-[0-9a-f]{32}$/u);
    assert.notEqual(edited.codes[0]?.id, warmCodeId);
    assert.equal(warm.documents.find(document => document.metadata.id === 'cached')?.metadata.title, 'Cached', 'cached objects do not alias earlier snapshots');
    rmSync(join(root, 'src/main.ts'));
    rmSync(join(root, 'docs/feature/cached/architecture.md'));
    const removed = await runApplication(getWorkspaceSnapshot(root, 'use'));
    assert.deepEqual(removed.codes, []);
    assert.deepEqual(removed.sources, []);
    assert.ok(!removed.pages.some(page => page.path === 'docs/feature/cached/architecture.md'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('unchanged projections return 304 and published external edits invalidate the previous ETag', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const url = `${base}/api/workspace`;
  try {
    await waitForWorkspaceProjection(base);
    const etag = await waitForWorkspaceNotModified(base);
    writeFileSync(join(root, 'docs/feature/cached/architecture.md'), '# External edit\n');
    // Source watching may publish before the explicit refresh or the next GET.
    const requested = await fetchFresh(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(requested.status, 202);
    await requested.arrayBuffer();
    const refreshed = await pollUntil(async () => {
      const response = await fetchFresh(url, { headers: { 'If-None-Match': etag } });
      if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
      const value = parseWorkspaceProjection(await response.text());
      return value?.snapshot.pages.some(page => page.derivedTitle === 'External edit') ? response : undefined;
    }, { description: 'refreshed projection', timeoutMs: 45_000 });
    assert.notEqual(refreshed.headers.get('etag'), etag);
    await waitForWorkspaceNotModified(base);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});
