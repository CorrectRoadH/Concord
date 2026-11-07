// 跨进程保证：运行环境——真实安装脚本接受没有独立解释器的归档，激活并运行其可执行入口。
import assert from 'node:assert/strict';
import { existsSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#run
// @issue docs/issues/bun-archive-installer.md
test('installer accepts the compiled archive without a separate JavaScript interpreter', () => withInstaller(f => {
  rmSync(join(f.scratch, 'candidate/runtime/node'), { force: true });
  f.publish('0.9.1');
  f.succeed('0.9.1');
  assert.equal(readlinkSync(f.bin), join(f.root, '0.9.1/bin/concord'));
  assert.equal(existsSync(join(f.root, '0.9.1/runtime/node')), false);
  const result = f.cli(['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'concord v0.9.1');
}));
