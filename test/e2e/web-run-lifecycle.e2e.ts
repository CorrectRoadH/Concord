import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig, waitForWorkspaceProjection } from '../support/support.ts';
import type { ViewJob } from '../../src/model/index.ts';

// @use-case docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#run
// @issue docs/issues/web-test-run-controls.md
test('test entries run and cancel their latest job and keep status and diagnostics inside the matching entry', async ({ page, workspace }) => {
  const root = workspace.root;
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'run', title: 'Runner controls' }); } finally { repo.close(); }
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/run.test.ts'), "// @feature docs/feature/run/README.md\n// @name runnable\nimport { test } from 'node:test';\ntest('runnable', () => {});\n\n// @feature docs/feature/run/README.md\n// @name independent\ntest('independent', () => {});\n");
  writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 5000 } });
  const server = await workspace.ready();
  const origin = `http://127.0.0.1:${server.port}`;
  const projection = await waitForWorkspaceProjection(origin);
  const selected = projection.snapshot.cases.find(item => item.name === 'runnable');
  assert.ok(selected);
  let jobs: ViewJob[] = [];
  const requests: unknown[] = [];
  // Simulate only the HTTP job boundary so every transient state is deterministic.
  await page.route('**/api/events', route => route.abort());
  await page.route('**/api/jobs', async route => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      jobs = [{ id: `job-${requests.length}`, caseId: selected.id, state: 'queued', startedAt: new Date().toISOString() }, ...jobs];
      await route.fulfill({ status: 202, json: { ok: true, value: jobs[0] } });
    } else await route.fulfill({ json: { ok: true, value: jobs } });
  });
  await page.route('**/api/jobs/*', async route => {
    assert.equal(route.request().method(), 'DELETE');
    assert.equal(new URL(route.request().url()).pathname, `/api/jobs/${jobs[0]!.id}`);
    jobs = [{ ...jobs[0]!, state: 'cancelling' }, ...jobs.slice(1)];
    await route.fulfill({ json: { ok: true, value: jobs[0] } });
  });
  await page.goto(`${origin}/features/run?tab=testing`);
  const entry = page.getByRole('listitem').filter({ has: page.getByText('runnable', { exact: true }) });
  const independent = page.getByRole('listitem').filter({ has: page.getByText('independent', { exact: true }) });
  await entry.getByRole('button', { name: '运行测试', exact: true }).click();
  assert.deepEqual(requests, [{ caseId: selected.id }]);
  await expect(entry.getByRole('status')).toContainText('排队');
  await expect(independent.getByRole('status')).toHaveCount(0);
  await entry.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(entry.getByRole('status')).toContainText('取消中');
  await expect(entry.getByRole('button', { name: '运行测试', exact: true })).toBeDisabled();
  for (const [state, label] of [['running', '运行中'], ['cancelled', '已取消'], ['completed', '已完成'], ['failed', '失败'], ['cleanup-failed', '清理失败']] as const) {
    jobs = [{ ...jobs[0]!, state, ...(state === 'failed' || state === 'cleanup-failed' ? { error: { code: 'RunnerDiagnostic', message: 'Visible runner diagnostic' } } : {}) }];
    await page.reload();
    await expect(entry.getByRole('status')).toContainText(label);
    await expect(entry.getByRole('button', { name: '取消运行', exact: true })).toHaveCount(state === 'running' ? 1 : 0);
    if (state === 'failed' || state === 'cleanup-failed') await expect(entry).toContainText('RunnerDiagnostic：Visible runner diagnostic');
  }
  jobs = [{ ...jobs[0]!, state: 'cancelled' }];
  await page.reload();
  await entry.getByRole('button', { name: '运行测试', exact: true }).click();
  await expect(entry.getByRole('status')).toContainText('排队');
  assert.equal(requests.length, 2);
});

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md
// @issue docs/issues/web-lifecycle-entries.md
test('Design and inactive Roadmap show lifecycle state without empty actions while other owners fall back to metadata', async ({ page, workspace }) => {
  const repo = new LocalRepository(workspace.root);
  try {
    createDocument(repo, 'design', { id: 'choice', title: 'Open choice' });
    createDocument(repo, 'roadmap', { id: 'cancelled', title: 'Cancelled direction' });
    createDocument(repo, 'feature', { id: 'ordinary', title: 'Ordinary feature' });
  } finally { repo.close(); }
  const server = await workspace.ready();
  const origin = `http://127.0.0.1:${server.port}`;
  const projection = await waitForWorkspaceProjection(origin);
  // Lifecycle rendering consumes projected metadata; state is not serialized by renderDocument.
  const value = { ...projection, snapshot: { ...projection.snapshot, documents: projection.snapshot.documents.map(document => document.metadata.kind === 'roadmap' ? { ...document, metadata: { ...document.metadata, state: 'cancelled' as const, cancellation: { reason: 'Not planned' } } } : document) } };
  await page.route('**/api/events', route => route.abort());
  await page.route('**/api/workspace', route => route.fulfill({ json: { ok: true, value } }));
  await page.goto(`${origin}/design/choice?tab=actions`);
  await expect(page.getByRole('tab', { name: '生命周期', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tabpanel')).toContainText('待定取舍');
  await expect(page.getByRole('heading', { name: '可用操作', exact: true })).toHaveCount(0);
  await page.goto(`${origin}/roadmap/cancelled?tab=actions`);
  await expect(page.getByRole('tabpanel')).toContainText('cancelled');
  await expect(page.getByRole('heading', { name: '可用操作', exact: true })).toHaveCount(0);
  await page.goto(`${origin}/features/ordinary?tab=actions`);
  await expect(page.getByRole('tab', { name: '元数据', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tab', { name: '生命周期', exact: true })).toHaveCount(0);
});
