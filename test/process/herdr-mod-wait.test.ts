// 跨进程保证：服务与 IPC——公开 workspace wait 命令启动并复用真实服务，观察文件变化且无变化时超时。
import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { command, fixture, record, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/cli.md#等待下一份结果
test('workspace wait starts the service, observes its accepted result and reuses its subscription for changes', { timeout: 30_000 }, async () => {
  const root = await fixture();
  try {
    const initial = await command(root, ['workspace', 'wait', '--timeout', '10']);
    assert.equal(initial.status, 0, initial.stderr);
    const first = JSON.parse(initial.stdout) as { sourceDigest: string; changed: boolean };
    assert.equal(first.changed, true); assert.equal(typeof first.sourceDigest, 'string');
    const token = record(root).token;
    const unchanged = await command(root, ['workspace', 'wait', '--after', first.sourceDigest, '--timeout', '1']);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.deepEqual(JSON.parse(unchanged.stdout), { operation: 'workspace-wait', changed: false, sourceDigest: first.sourceDigest });
    const waiting = command(root, ['workspace', 'wait', '--after', first.sourceDigest, '--timeout', '10']);
    const page = join(root, 'docs/feature/reader/README.md');
    writeFileSync(page + '.tmp', readFileSync(page, 'utf8') + '\nChanged through the filesystem.\n');
    renameSync(page + '.tmp', page);
    const changed = await waiting;
    assert.equal(changed.status, 0, changed.stderr);
    const next = JSON.parse(changed.stdout) as { changed: boolean; sourceDigest: string };
    assert.equal(next.changed, true); assert.notEqual(next.sourceDigest, first.sourceDigest);
    assert.equal(record(root).token, token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
