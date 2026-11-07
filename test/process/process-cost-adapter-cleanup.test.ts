// 跨进程保证：服务与 IPC——adapter fixture使用真实stop回收服务，停止失败时保留消费者现场。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { externalCase } from '../support/external-adapter-fixture.ts';
import { runApplication } from '../support/repository.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/engineering/testing/use-case/extend-fixtures.md#create
test('an adapter fixture retains its consumer when service shutdown cannot be confirmed', async () => {
  const receiptDirectory = mkdtempSync(join(tmpdir(), 'concord-adapter-retained-'));
  const receipt = join(receiptDirectory, 'retained.txt');
  const previousReceipt = process.env.CONCORD_TEST_RETAIN_FILE;
  process.env.CONCORD_TEST_RETAIN_FILE = receipt;
  let root: string | undefined;
  try {
    await assert.rejects(runApplication(Effect.scoped(Effect.gen(function*() {
      const fixture = yield* externalCase();
      yield* Effect.sync(() => {
        root = fixture.consumer;
        // Reclaim the actual service before injecting an invalid ownership record.
        stopWorkspaceServer(root);
        const path = join(root, '.git/concord/server/current.json');
        assert.equal(existsSync(path), false);
        writeFileSync(join(root, 'cleanup-evidence.txt'), 'retain these consumer bytes\n');
        writeFileSync(path, '{broken');
      });
    }))), /Fixture service cleanup failed/u);
    assert.ok(root !== undefined && existsSync(root), 'failed stop must not remove the consumer');
    assert.equal(readFileSync(join(root, 'cleanup-evidence.txt'), 'utf8'), 'retain these consumer bytes\n');
    assert.equal(readFileSync(receipt, 'utf8'), `${root}\n`, 'retention must be reported through the supplied receipt path');
  } finally {
    if (previousReceipt === undefined) delete process.env.CONCORD_TEST_RETAIN_FILE;
    else process.env.CONCORD_TEST_RETAIN_FILE = previousReceipt;
    // The real service was already confirmed stopped before the failure injection.
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    rmSync(receiptDirectory, { recursive: true, force: true });
  }
});
