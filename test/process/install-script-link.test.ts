// 跨进程保证：运行环境——真实安装脚本切换链接失败时保留原安装字节、入口及可运行版本并清理候选。
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { command, withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('a failed atomic link switch removes the candidate and preserves the working installation', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1');
  const before = readlinkSync(f.bin), previousManifest = readFileSync(join(f.root, '0.9.1/app/package.json'), 'utf8');
  f.publish('0.9.2'); const blocked = join(f.home, 'blocked'); mkdirSync(join(blocked, 'concord'), { recursive: true });
  const result = f.install('0.9.2', { CONCORD_INSTALL_DIR: blocked }); assert.notEqual(result.status, 0); assert.match(result.stderr, /switch the Concord link/);
  assert.equal(readlinkSync(f.bin), before); assert.equal(readFileSync(join(f.root, '0.9.1/app/package.json'), 'utf8'), previousManifest);
  assert.deepEqual(readdirSync(f.root), ['0.9.1']); assert.deepEqual(readdirSync(blocked), ['concord']);
  assert.equal(f.cli(['--version']).status, 0);
}));

// @spec docs/feature/cross-platform-release/architecture.md#安装脚本
test('interruption after the link rename preserves the now-current installation', () => withInstaller(f => {
  f.publish('0.9.1');
  f.succeed('0.9.1');
  f.publish('0.9.2');
  writeFileSync(join(f.adapters, 'mv'), `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const move = spawnSync(${JSON.stringify(command('mv'))}, args, { stdio: 'inherit' });
if (move.status === 0 && args.at(-2)?.includes('/.concord-install-')) {
  process.kill(process.ppid, 'SIGTERM');
}
process.exit(move.status ?? 1);
`, { mode: 0o755 });

  const result = f.install('0.9.2');
  assert.equal(result.status, 1, result.stderr);
  const current = join(f.root, '0.9.2');
  assert.equal(readlinkSync(f.bin), join(current, 'bin/concord'));
  const cli = f.cli(['--version']);
  assert.equal(cli.status, 0, String(cli.error ?? cli.stderr));
  assert.equal(cli.stdout.trim(), 'concord v0.9.2');
  assert.match(readFileSync(join(current, '.archive-sha256'), 'utf8'), /^[a-f0-9]{64}\n$/);
  assert.equal(readFileSync(join(current, '.activated'), 'utf8'), '');
}));
