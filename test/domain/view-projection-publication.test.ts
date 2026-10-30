import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ViewProjectionManager, ViewScanManager, createDocument, initialize } from '../../src/app/index.js';
import { cacheDatabasePath, openHawdb } from '../../src/base/cache/index.js';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.js';
import { ConcordError } from '../../src/model/index.js';
import { LocalRepository } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';
import { pollUntil, writeProjectConfig } from '../support/support.js';

function fixture(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'projected', title: 'Projected feature', pages: ['architecture'] }); } finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.ts'), 'export const projectedValue = 1;\n');
  return root;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a completed workspace scan survives brief contention at publication', async t => {
  const root = fixture();
  const scan = ViewScanManager.prototype.scan;
  let database: ReturnType<typeof openHawdb> | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  let scans = 0;
  let resumeReconciliation!: () => void;
  const reconciliation = new Promise<void>(resolve => { resumeReconciliation = resolve; });
  // 扫描仍走真实子进程；只在它交付候选时放入真实锁竞争，避免靠扫描耗时碰运气。
  t.mock.method(ViewScanManager.prototype, 'scan', async function(this: ViewScanManager, signal?: AbortSignal) {
    // Watch setup legitimately requests another scan. Hold that independent scan
    // so the assertion proves the first candidate itself survives contention.
    if (scans > 0) await reconciliation;
    const reply = await scan.call(this, signal);
    scans += 1;
    if (scans === 1) {
      database = openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root)), { readOnly: false, create: true });
      release = setTimeout(() => database?.close(), 100);
    }
    return reply;
  });
  const manager = new ViewProjectionManager(root); manager.start();
  try {
    await pollUntil(async () => scans > 0 ? true : undefined, { description: 'real scan candidate' });
    const value = await pollUntil(async () => { try { const value = await manager.read(); return value.projection.status === 'ready' ? value : undefined; } catch (cause) { if (cause instanceof ConcordError && ['WorkspaceProjectionPending', 'WorkspaceProjectionUnavailable'].includes(cause.code)) return undefined; throw cause; } }, { timeoutMs: 10_000, description: 'published completed scan' });
    assert.equal(value.projection.status, 'ready');
    assert.equal(scans, 1, 'the completed candidate is published without scanning again');
  } finally {
    clearTimeout(release);
    database?.close();
    resumeReconciliation();
    await manager.close();
    rmSync(root, { recursive: true, force: true });
  }
});
