import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { startHostedViewServer } from '../../src/entry/http/index.ts';
import { OperationRequest } from '../../src/entry/server/index.ts';
import { fetchFresh } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#inspect-native
test('HTTP exposes no test job endpoints while ordinary actions remain available', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-web-observations-'));
  const unused = (): never => { throw new Error('Unexpected observation or computation'); };
  const actions: unknown[] = [];
  let server: Awaited<ReturnType<typeof startHostedViewServer>> | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    server = await startHostedViewServer({ root, webRoot: root, port: 0 }, {
      verify: async () => {}, workspace: unused, refresh: unused, read: unused, git: unused, diff: unused, compile: unused,
      action: async input => { actions.push(input); return { available: true }; }, subscribe: unused, sse: unused,
    }, makeRuntimeEnvironment(root, process.env), () => true);
    for (const [method, path] of [['GET', '/api/jobs'], ['POST', '/api/jobs'], ['DELETE', '/api/jobs/ccjob_00000000-0000-0000-0000-000000000000']] as const) {
      const response = await fetchFresh(new URL(path, server.address), { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ caseId: 'cart' }) } : {}) });
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.ok, false);
    }
    for (const input of [
      ...['test.run', 'test.cancel', 'test.jobs'].map(action => ({ action })),
      { action: 'init', runner: { kind: 'node-test', timeoutMs: 1000 } },
      { action: 'issue.close', id: 'cart', fixed: true },
      { action: 'issue.close', id: 'cart', defect: 'HEAD~1', fix: 'HEAD' },
    ]) {
      const response = await fetchFresh(new URL('/api/action', server.address), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 400);
      await response.body?.cancel();
    }
    assert.deepEqual(actions, []);
    const response = await fetchFresh(new URL('/api/action', server.address), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cache.status' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, value: { available: true } });
    assert.deepEqual(actions, [{ action: 'cache.status' }]);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#inspect-native
test('the operation protocol accepts ordinary actions and rejects test jobs', () => {
  const decode = Schema.decodeUnknownSync(OperationRequest, { onExcessProperty: 'error' });
  const common = { root: '/workspace', cwd: '/workspace', environment: {}, snapshot: {} };
  assert.equal(decode({ ...common, kind: 'action', input: { action: 'cache.status' } }).kind, 'action');
  assert.throws(() => decode({ ...common, kind: 'job', caseId: 'cart' }));
});
