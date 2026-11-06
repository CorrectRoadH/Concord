// 跨进程保证：运行环境——真实安装脚本依据存活PID保留在用版本，升级回滚保留inode并清除死亡标记。
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { run, withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('latest, explicit versions and custom links keep the current and two most recent inactive installations', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1'); f.publish('0.9.2'); f.succeed('0.9.2');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.2']);
  f.publish('0.9.3'); mkdirSync(join(f.release, 'tag')); writeFileSync(join(f.release, 'tag/v0.9.3'), ''); f.succeed();
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.2', '0.9.3']); assert.equal(readlinkSync(f.bin), join(f.root, '0.9.3', f.manifest.bin.concord));
  const installedEntry = join(f.root, '0.9.3/bin/concord'), inode = lstatSync(installedEntry).ino;
  const activation = join(f.root, '0.9.3/.activated'); utimesSync(activation, 1, 1);
  const custom = join(f.home, 'custom bin'); f.succeed('0.9.3', { CONCORD_INSTALL_DIR: custom });
  assert.equal(lstatSync(installedEntry).ino, inode); assert.ok(lstatSync(activation).mtimeMs > 1000);
  assert.equal(readlinkSync(join(custom, 'concord')), readlinkSync(f.bin)); assert.equal(lstatSync(f.bin).isSymbolicLink(), true);
  assert.equal(run([join(custom, 'concord'), '--version'], f.env, f.scratch).status, 0);
  f.publish('0.9.1'); f.succeed('0.9.1'); assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.2', '0.9.3']);
  assert.equal(f.cli(['--version']).stdout.trim(), 'concord v0.9.1');
  assert.match(readFileSync(join(f.release, 'requests'), 'utf8'), /releases\/latest\n/);
}));

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('live installations survive upgrades and rollback while dead markers do not consume retention slots', () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1');
  const markers = join(f.root, '0.9.1/.in-use'); mkdirSync(markers);
  writeFileSync(join(markers, String(process.pid)), '');
  for (const version of ['0.9.2', '0.9.3', '0.9.4', '0.9.5']) { f.publish(version); f.succeed(version); }
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.3', '0.9.4', '0.9.5']);
  process.kill(process.pid, 0);
  f.succeed('0.9.1');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.4', '0.9.5']);
  const dead = join(f.root, '0.9.4/.in-use'); mkdirSync(dead);
  writeFileSync(join(dead, '2147483647'), '');
  f.publish('0.9.6'); f.succeed('0.9.6');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.4', '0.9.5', '0.9.6']);
  assert.deepEqual(readdirSync(dead), []);
  f.publish('0.9.7'); f.succeed('0.9.7');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.5', '0.9.6', '0.9.7']);
  process.kill(process.pid, 0);
}));
