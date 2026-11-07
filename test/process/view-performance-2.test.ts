// 跨进程保证：OS 锁与互斥——独立读进程持有shared lease时服务可读取而写入被拒绝，reader被SIGKILL后可恢复写入。
import { createDocument, initialize } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { installationResources } from "../../src/base/installation/index.ts";
import { installedConcordCli } from "../support/support.ts";
import { dirname } from "node:path";
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

function leaseReader(root: string, operation: string, release: boolean) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireTraceLeaseSync, releaseTraceLeaseSync } from './src/base/publication/index.ts'; const lease = acquireTraceLeaseSync(process.argv[1], 'shared', ${JSON.stringify(operation)}, undefined, undefined, process.env); process.stdout.write('held'); process.stdin.resume(); ${release ? "process.stdin.once('end', () => releaseTraceLeaseSync(lease, 'read-test'));" : ''}`, root], { cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', diagnostic = '', finished = false;
  child.stderr.on('data', data => { diagnostic += data.toString(); });
  const closed = new Promise<void>(resolve => child.once('close', () => { finished = true; resolve(); }));
  const ready = new Promise<void>((resolve, reject) => {
    const onData = (data: Buffer) => { output += data.toString(); if (output.includes('held')) { cleanup(); resolve(); } };
    const onError = (cause: Error) => { cleanup(); reject(cause); };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup(); reject(new Error(`Lease reader exited before ready: code=${code}; signal=${signal}; stdout=${output}; stderr=${diagnostic}`));
    };
    const cleanup = () => { child.stdout.off('data', onData); child.off('error', onError); child.off('close', onClose); };
    child.stdout.on('data', onData); child.once('error', onError); child.once('close', onClose);
  });
  return { ready, async close(kill = false) { if (!finished) { if (kill) child.kill('SIGKILL'); else child.stdin.end(); } await closed; } };
}


// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('independent readers share a lease while publication still requires exclusivity', async () => {
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const child = leaseReader(root, 'read-test', true);
  try {
    await child.ready;
    const file = await fetchFresh(`http://127.0.0.1:${server.port}/api/file?path=docs%2Ffeature%2Fcached%2FREADME.md`);
    assert.equal(file.status, 200);
    assert.match(await file.text(), /Cached/);
    const workspace = await fetchFresh(`http://127.0.0.1:${server.port}/api/workspace`);
    assert.ok([200, 202].includes(workspace.status), await workspace.text());
    (await assert.rejects(async () => (await LocalRepository.open(root)), { code: 'RepositoryBusy' }));
  } finally {
    await child.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery removes dead owners while optimistic readers remain unregistered', async () => {
  const root = (await fixture());
  const reader = (await LocalRepository.open(root, { dryRun: true }));
  const child = leaseReader(root, 'dead-reader', false);
  try {
    reader.beginSnapshot();
    await child.ready;
    await child.close(true);
    assert.equal(recoverPublicationLeaseSync(root, process.env).length, 1);
    reader.endSnapshot();
    recoverPublicationLeaseSync(root, process.env);
    const writer = (await LocalRepository.open(root));
    writer.snapshot(() => assert.ok(writer.read('concord.config.ts')));
    writer.close();
  } finally {
    reader.close();
    await child.close(true);
    rmSync(root, { recursive: true, force: true });
  }
});
