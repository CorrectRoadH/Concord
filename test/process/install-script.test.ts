// 跨进程保证：运行环境——真实POSIX安装脚本在最小PATH和平台工具边界下校验归档并激活可运行入口。
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { command, installer, run, withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#run
// @issue docs/issues/bun-archive-installer.md
test('first install verifies the local archive and runs its root executable', { timeout: 55_000 }, () => withInstaller(f => {
  let result = f.install('0.8.0'); assert.notEqual(result.status, 0); assert.equal(existsSync(join(f.home, '.local')), false);
  for (const invalid of ['../escape', '0.9.1\n../../escape']) {
    result = f.install(invalid); assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid CONCORD_VERSION/); assert.equal(existsSync(join(f.home, '.local')), false);
  }
  f.publish('0.9.1', { corrupt: true });
  result = f.install('0.9.1'); assert.notEqual(result.status, 0); assert.match(result.stderr, /checksum/iu); assert.equal(existsSync(join(f.home, '.local')), false);
  f.publish('0.9.1'); result = f.succeed('0.9.1');
  assert.equal(readlinkSync(f.bin), join(f.root, '0.9.1', f.manifest.bin.concord));
  assert.match(result.stdout, /Installing Concord 0\.9\.1/); assert.match(result.stdout, /PATH/);
  const cli = f.cli(['--version']); assert.equal(cli.status, 0, cli.stderr); assert.equal(cli.stdout.trim(), 'concord v0.9.1');
  const help = f.cli(['--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /concord/iu);
  for (const name of ['node', 'bun']) assert.equal(existsSync(join(f.root, `0.9.1/runtime/${name}`)), false);
  assert.equal(existsSync(join(f.root, '0.9.1/app/package.json')), true);
  assert.equal(existsSync(join(f.home, '.bashrc')), false); assert.equal(existsSync(join(f.home, '.zshrc')), false);
}));

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('unsupported platform and missing prerequisites fail before any installation writes', () => Effect.runSync(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-install-preflight-'));
  try {
    const home = join(scratch, 'home'), adapters = join(scratch, 'adapters'); mkdirSync(home); mkdirSync(adapters);
    for (const name of ['grep', 'head', 'sed']) symlinkSync(command(name), join(adapters, name));
    const executable = (name: string, body: string) => { writeFileSync(join(adapters, name), `#!${process.execPath}\n${body}\n`); chmodSync(join(adapters, name), 0o755); };
    const env = { ...process.env, HOME: home, PATH: adapters, NODE_OPTIONS: '' };
    const install = () => run([command('sh'), installer], env, scratch);
    for (const platform of [['Darwin', 'x86_64'], ['Linux', 'aarch64'], ['MINGW64_NT', 'x86_64']]) {
      executable('uname', `process.stdout.write(process.argv[2] === '-s' ? '${platform[0]}' : '${platform[1]}');`);
      const result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Linux x64.*Apple Silicon/); assert.match(result.stderr, /Homebrew.*Nix/); assert.deepEqual(readdirSync(home), []);
    }
    executable('uname', "process.stdout.write(process.argv[2] === '-s' ? 'Darwin' : 'arm64');");
    executable('uname', "process.stdout.write(process.argv[2] === '-s' ? 'Linux' : 'x86_64');");
    executable('ldd', "process.stdout.write('ldd (GNU libc) 2.39\\n');");
    let result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Git/); assert.deepEqual(readdirSync(home), []);
    executable('ldd', "process.stderr.write('musl libc\\n'); process.exitCode = 1;");
    result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /glibc/); assert.deepEqual(readdirSync(home), []);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
