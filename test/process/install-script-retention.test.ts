// 跨进程保证：运行环境——真实安装脚本依据存活PID保留在用版本，清除死亡标记。
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, readlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { command, installer, withInstaller } from '../support/install-script-fixture.ts';

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

const setupRetention = (f: Parameters<Parameters<typeof withInstaller>[0]>[0]) => {
  for (const [index, version] of ['0.9.1', '0.9.2', '0.9.3', '0.9.4'].entries()) {
    f.publish(version);
    f.succeed(version);
    const tick = new Date(1_700_000_000_000 + index * 1000);
    utimesSync(join(f.root, version, '.activated'), tick, tick);
  }
  f.publish('0.9.5');
  return join(f.root, '0.9.2');
};

// @spec docs/feature/cross-platform-release/architecture.md#安装脚本
test('a second same-version installer cannot publish while the installation root is locked', () => withInstaller(f => {
  f.publish('0.9.1');
  const checkpoint = join(f.scratch, 'parallel-install');
  const current = join(f.root, '0.9.1');
  writeFileSync(join(f.adapters, 'mv'), `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.at(-1) === ${JSON.stringify(current)} && process.env.INSTALL_FIXTURE_PARALLEL !== 'yes') {
  const second = spawnSync('sh', [${JSON.stringify(installer)}], {
    env: { ...process.env, INSTALL_FIXTURE_PARALLEL: 'yes' }, encoding: 'utf8'
  });
  writeFileSync(${JSON.stringify(checkpoint)}, String(second.status) + '\\n' + second.stderr);
}
process.exit(spawnSync(${JSON.stringify(command('mv'))}, args, { stdio: 'inherit' }).status ?? 1);
`, { mode: 0o755 });
  f.succeed('0.9.1');
  assert.deepEqual(readdirSync(current).sort(), ['.activated', '.archive-sha256', 'app', 'bin']);
  const second = readFileSync(checkpoint, 'utf8');
  assert.match(second, /^1\n/);
  assert.ok(second.includes(join(f.root, '.install-lock')), second);
  assert.deepEqual(readdirSync(f.root), ['0.9.1']);
}));

// @spec docs/feature/cross-platform-release/architecture.md#安装脚本
test('rollback cannot switch to a version selected for deletion by another installer', () => withInstaller(f => {
  const victim = setupRetention(f);
  const checkpoint = join(f.scratch, 'parallel-rollback');
  const rollback = `
    const result = spawnSync('sh', [${JSON.stringify(installer)}], {
      env: { ...process.env, CONCORD_VERSION: '0.9.2' }, encoding: 'utf8'
    });
    writeFileSync(${JSON.stringify(checkpoint)}, String(result.status) + '\\n' + result.stderr);
  `;
  for (const tool of ['mv', 'rm']) {
    writeFileSync(join(f.adapters, tool), `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[${tool === 'mv' ? '0' : '1'}] === ${JSON.stringify(victim)} && process.env.CONCORD_VERSION === '0.9.5') {
  ${rollback}
}
process.exit(spawnSync(${JSON.stringify(command(tool))}, args, { stdio: 'inherit' }).status ?? 1);
`, { mode: 0o755 });
  }
  f.succeed('0.9.5');
  assert.equal(readlinkSync(f.bin), join(f.root, '0.9.5/bin/concord'));
  assert.match(readFileSync(checkpoint, 'utf8'), /^1\n/);
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.3', '0.9.4', '0.9.5']);
}));

// @spec docs/feature/cross-platform-release/architecture.md#安装脚本
test('reclamation restores a version when a live marker appears after the first scan', () => withInstaller(f => {
  const victim = setupRetention(f);
  for (const tool of ['mv', 'rm']) {
    writeFileSync(join(f.adapters, tool), `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const victim = ${JSON.stringify(victim)};
if (args[${tool === 'mv' ? '0' : '1'}] === victim) {
  const markers = join(victim, '.in-use');
  mkdirSync(markers, { recursive: true });
  writeFileSync(join(markers, ${JSON.stringify(String(process.pid))}), '');
}
process.exit(spawnSync(${JSON.stringify(command(tool))}, args, { stdio: 'inherit' }).status ?? 1);
`, { mode: 0o755 });
  }
  f.succeed('0.9.5');
  assert.equal(readFileSync(join(victim, '.in-use', String(process.pid)), 'utf8'), '');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.2', '0.9.3', '0.9.4', '0.9.5']);
}));
