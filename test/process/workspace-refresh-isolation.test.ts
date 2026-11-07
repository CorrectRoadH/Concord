// 跨进程保证：服务与 IPC——后台工作区扫描阻塞时，前台文件读取与写入仍可完成。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { digest } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { fetchFresh, pollUntil, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.ts';
import { startViewServer } from '../support/view-server.ts';

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
// @issue docs/issues/warm-reads-over-budget.md
for (const boundary of ['scan', 'source digest'] as const) test(`file and action finish before a blocked workspace refresh ${boundary} is released`, { timeout: 40_000 }, async () => {
  const root = (await createConsumer());
  writeProjectConfig(root, { sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'), { recursive: true });
  const before = 'export const foreground = true;\n', path = 'src/foreground.ts';
  writeFileSync(join(root, path), before);
  writeFileSync(join(root, 'src/refresh-gate.ts'), 'export const background = true;\n');
  const hold = join(root, '.git/hold-scan'), reached = join(root, '.git/scan-reached'), hook = join(root, '.git/scan-gate.ts');
  // Only the refresh filesystem boundary is held; RPC, actions and source
  // publication use their production implementations.
  writeFileSync(hook, `import fs from 'node:fs';
import { mock as bunMock } from 'bun:test';
const syncBuiltinESMExports = () => bunMock.module('node:fs', () => ({ ...fs, default: fs }));
const name = ${JSON.stringify(boundary)} === 'scan' ? 'openSync' : 'lstatSync';
const original = fs[name];
fs[name] = function(path, ...args) {
  const previousLimit = Error.stackTraceLimit;
  let refresh = ${JSON.stringify(boundary)} === 'scan';
  try {
    Error.stackTraceLimit = 100;
    refresh ||= new Error().stack?.includes('/app/workspace-source.ts') === true;
  } finally { Error.stackTraceLimit = previousLimit; }
  if (refresh && String(path).endsWith('/src/refresh-gate.ts') && fs.existsSync(${JSON.stringify(hold)})) {
    fs.writeFileSync(${JSON.stringify(reached)}, String(process.pid));
    while (fs.existsSync(${JSON.stringify(hold)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
  const previous = process.env.BUN_OPTIONS;
  process.env.BUN_OPTIONS = `${previous ?? ''} --preload=${pathToFileURL(hook).href}`;
  let server: Awaited<ReturnType<typeof startViewServer>> | undefined;
  try { server = await startViewServer({ root }); }
  finally { if (previous === undefined) delete process.env.BUN_OPTIONS; else process.env.BUN_OPTIONS = previous; }
  try {
    await waitForWorkspaceProjection(new URL(server.address).origin);
    writeFileSync(hold, 'hold');
    writeFileSync(join(root, 'src/refresh-gate.ts'), 'export const background = false;\n');
    const trigger = await fetchFresh(new URL('/api/workspace', server.address), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(trigger.status, 202, await trigger.text());
    await pollUntil(async () => existsSync(reached) ? true : undefined, { description: 'workspace scanner reaches held source', timeoutMs: 10_000 });
    const [file, action] = await Promise.all([
      fetchFresh(new URL(`/api/file?path=${path}`, server.address), { signal: AbortSignal.timeout(5000) }),
      fetchFresh(new URL('/api/action', server.address), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'source.set', path, body: 'export const changed = true;\n', expectedDigest: digest(before) }), signal: AbortSignal.timeout(5000) }),
    ]);
    assert.equal(file.status, 200, await file.text());
    assert.equal(action.status, 200, await action.text());
    assert.ok(existsSync(hold), 'both requests complete without releasing the scan');
  } finally {
    rmSync(hold, { force: true });
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
