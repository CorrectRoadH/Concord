// 跨进程保证：运行环境——真实安装脚本依据存活PID保留在用版本，清除死亡标记。
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('installation cleanup preserves live processes and removes dead markers', () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1');
  const markers = join(f.root, '0.9.1/.in-use'); mkdirSync(markers);
  writeFileSync(join(markers, String(process.pid)), '');
  for (const version of ['0.9.2', '0.9.3', '0.9.4', '0.9.5']) { f.publish(version); f.succeed(version); }
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.3', '0.9.4', '0.9.5']);
  process.kill(process.pid, 0);
  const dead = join(f.root, '0.9.4/.in-use'); mkdirSync(dead);
  writeFileSync(join(dead, '2147483647'), '');
  f.publish('0.9.6'); f.succeed('0.9.6');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.4', '0.9.5', '0.9.6']);
  assert.deepEqual(readdirSync(dead), []);
  f.publish('0.9.7'); f.succeed('0.9.7');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.5', '0.9.6', '0.9.7']);
  process.kill(process.pid, 0);
}));
