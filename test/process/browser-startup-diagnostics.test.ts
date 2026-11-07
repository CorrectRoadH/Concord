// 跨进程保证：服务与 IPC——浏览器 worker 启动失败保留服务原始原因，并在返回错误前清理部分启动的工作区。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { openBrowserWorker } from '../support/browser-shared-fixture.ts';
import { ViewServerStartupFailed } from '../e2e/server.ts';

// @feature docs/engineering/testing/architecture.md#浏览器与诊断
test('browser launch diagnostics retain the original fixture failure after cleanup', async () => {
  await assert.rejects(openBrowserWorker(AbortSignal.abort(new Error('browser-fixture-original-cancellation')), 'startup-diagnostics'), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'BrowserWorkerStartupFailed');
    assert.match(error.message, /browser-fixture-original-cancellation/u);
    let cause: unknown = error;
    for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
      if (cause instanceof ViewServerStartupFailed) {
        assert.equal(cause.cleanupComplete, true);
        assert.equal(existsSync(cause.root), false, 'the failed startup releases its owned worktree before reporting');
        return true;
      }
      cause = cause.cause;
    }
    assert.fail('the original ViewServerStartupFailed must remain in the cause chain');
  });
});
