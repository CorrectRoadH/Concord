// 跨进程保证：进程终止与信号——每次Web写入消费独立operation子进程，空闲worker被杀后补位，服务停止回收替补。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { digest } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { command, record, recordPath, stop } from '../support/workspace-server-fixture.ts';
import { pollUntil, fetchFresh, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.ts';
import { startViewServer } from '../e2e/server.ts';

const children = (pid: number) => execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n').flatMap(line => {
  const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
  return match && Number(match[2]) === pid && /\/entry\/server\/operation\/main\.ts(?:\s|$)/u.test(match[3]!) ? [Number(match[1])] : [];
});
const gone = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };
const idle = (pid: number, excluded: readonly number[] = []) => pollUntil(async () => {
  const values = children(pid).filter(value => !excluded.includes(value));
  return values.length === 1 ? values[0] : undefined;
}, { description: 'one independent idle operation process is ready to accept a request', timeoutMs: 5000 });

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('each Web write consumes a different idle process and stopped services reclaim the replacement', { skip: process.platform === 'win32', timeout: 25_000 }, async () => {
  const root = createConsumer();
  writeProjectConfig(root, { sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'), { recursive: true });
  const path = 'src/operation.ts'; writeFileSync(join(root, path), 'export const value = 0;\n');
  const server = await startViewServer({ root });
  try {
    await waitForWorkspaceProjection(new URL(server.address).origin);
    const pid = record(root).pid;
    const first = await idle(pid);
    for (const [index, consumed] of [[1, first], [2, undefined]] as const) {
      const worker = consumed ?? await idle(pid, [first]);
      assert.ok(worker);
      const before = readFileSync(join(root, path), 'utf8');
      const response = await fetchFresh(new URL('/api/action', server.address).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'source.set', path, body: `export const value = ${index};\n`, expectedDigest: digest(before) }) });
      assert.equal(response.status, 200, await response.text());
      await pollUntil(async () => gone(worker) ? true : undefined, { description: 'the single-use operation process exits before its receipt is acknowledged' });
      assert.equal(readFileSync(join(root, path), 'utf8'), `export const value = ${index};\n`);
    }
    const replacement = await idle(pid, [first]);
    const stopped = await command(root, ['server', 'stop']); assert.equal(stopped.status, 0, stopped.stderr);
    await pollUntil(async () => gone(replacement!) && !existsSync(recordPath(root)) ? true : undefined, { description: 'stopping reclaims the unused operation group before removing the running record' });
  } finally { await server.close(); await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('killing an unused operation process preserves the next write and produces a new idle process', { skip: process.platform === 'win32', timeout: 20_000 }, async () => {
  const root = createConsumer();
  writeProjectConfig(root, { sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'), { recursive: true });
  const path = 'src/operation.ts', before = 'export const value = 0;\n', after = 'export const recovered = true;\n';
  writeFileSync(join(root, path), before);
  const server = await startViewServer({ root });
  try {
    await waitForWorkspaceProjection(new URL(server.address).origin);
    const pid = record(root).pid, unused = await idle(pid);
    assert.ok(unused); process.kill(unused, 'SIGKILL');
    await pollUntil(async () => gone(unused) ? true : undefined, { description: 'the unused operation process is reaped' });
    const response = await fetchFresh(new URL('/api/action', server.address).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'source.set', path, body: after, expectedDigest: digest(before) }) });
    assert.equal(response.status, 200, await response.text());
    assert.equal(readFileSync(join(root, path), 'utf8'), after);
    assert.notEqual(await idle(pid, [unused]), unused);
  } finally { await server.close(); await stop(root); rmSync(root, { recursive: true, force: true }); }
});
