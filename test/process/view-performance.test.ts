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

import { startViewServer } from '../support/view-server.ts';
import { parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

async function fixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'concord-view-performance-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = (await LocalRepository.open(root, { initialize: true }));
  try {
    (await initialize(repo, false, { testRoots: [], sourceRoots: ['src'] }));
    (await createDocument(repo, 'feature', { id: 'cached', title: 'Cached', pages: ['architecture'] }));
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.ts'), '// @concord-code\n// @concord-implements docs/feature/cached/README.md\nexport function cachedCode() { return true; }\n');
  return root;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('HTTP projection retains orphan annotation incompleteness and observes its repair', async () => {
  const root = (await fixture());
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
test('unchanged projections return 304 and published external edits invalidate the previous ETag', async () => {
  const root = (await fixture());
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
