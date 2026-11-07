// 跨进程保证：OS 锁与互斥——独立读进程持有shared lease时服务可读取而写入被拒绝，reader被SIGKILL后可恢复写入。
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
test('independent readers share a lease while publication still requires exclusivity', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { acquireTraceLeaseSync, releaseTraceLeaseSync } from './src/base/publication/index.ts'; const lease=acquireTraceLeaseSync(process.argv[1], 'shared', 'read-test'); process.stdout.write('held'); process.stdin.resume(); process.stdin.once('end',()=>releaseTraceLeaseSync(lease,'read-test'));", root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(child.stdout!, 'data');
    const file = await fetchFresh(`http://127.0.0.1:${server.port}/api/file?path=docs%2Ffeature%2Fcached%2FREADME.md`);
    assert.equal(file.status, 200);
    assert.match(await file.text(), /Cached/);
    const workspace = await fetchFresh(`http://127.0.0.1:${server.port}/api/workspace`);
    assert.ok([200, 202].includes(workspace.status), await workspace.text());
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
test('recovery removes dead owners while optimistic readers remain unregistered', async () => {
  const root = fixture();
  const reader = new LocalRepository(root, { dryRun: true });
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { acquireTraceLeaseSync } from './src/base/publication/index.ts'; acquireTraceLeaseSync(process.argv[1], 'shared', 'dead-reader'); process.stdout.write('held'); process.stdin.resume();", root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    reader.beginSnapshot();
    await once(child.stdout!, 'data');
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    assert.equal(recoverPublicationLeaseSync(root).length, 1);
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
