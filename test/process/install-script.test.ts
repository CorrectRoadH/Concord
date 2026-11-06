import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { command, installer, run, withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('first install verifies the local release and runs the real production CLI', { timeout: 55_000 }, () => withInstaller(f => {
  let result = f.install('0.8.0'); assert.notEqual(result.status, 0); assert.equal(existsSync(join(f.home, '.local')), false);
  result = f.install('../escape'); assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid CONCORD_VERSION/); assert.equal(existsSync(join(f.home, '.local')), false);
  f.publish('0.9.1', { corrupt: true });
  result = f.install('0.9.1'); assert.notEqual(result.status, 0); assert.match(result.stderr, /checksum/iu); assert.equal(existsSync(join(f.home, '.local')), false);
  f.publish('0.9.1'); result = f.succeed('0.9.1');
  assert.equal(readlinkSync(f.bin), join(f.root, '0.9.1', f.manifest.bin.concord));
  assert.match(result.stdout, /Installing Concord 0\.9\.1/); assert.match(result.stdout, /PATH/);
  const cli = f.cli(['--version']); assert.equal(cli.status, 0, cli.stderr); assert.equal(cli.stdout.trim(), 'concord v0.9.1');
  const help = f.cli(['--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /concord/iu);
  assert.equal(existsSync(join(f.root, '0.9.1/node_modules/@playwright')), false);
  assert.equal(existsSync(join(f.root, '0.9.1/node_modules/effect/package.json')), true);
  const workspace = join(f.scratch, 'workspace'); mkdirSync(workspace);
  const git = run(['git', 'init', workspace], f.env, f.scratch); assert.equal(git.status, 0, git.stderr);
  const initialized = run([f.bin, '--root', workspace, '--json', 'init', '--docs-only', '--yes'], f.env, workspace);
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  assert.equal(existsSync(join(workspace, 'concord.config.ts')), true);
  const checked = run([f.bin, '--root', workspace, '--server=command', '--json', 'check'], f.env, workspace);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const Check = Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, complete: Schema.Boolean }));
  assert.deepEqual(Schema.decodeUnknownSync(Check)(checked.stdout), { ok: true, complete: true });
  assert.equal(existsSync(join(f.home, '.bashrc')), false); assert.equal(existsSync(join(f.home, '.zshrc')), false);
}));

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('unsupported platform and missing prerequisites fail before any installation writes', () => Effect.runSync(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-install-preflight-'));
  try {
    const home = join(scratch, 'home'), adapters = join(scratch, 'adapters'); mkdirSync(home); mkdirSync(adapters);
    symlinkSync(command('grep'), join(adapters, 'grep'));
    const executable = (name: string, body: string) => { writeFileSync(join(adapters, name), `#!${process.execPath}\n${body}\n`); chmodSync(join(adapters, name), 0o755); };
    const env = { ...process.env, HOME: home, PATH: adapters, NODE_OPTIONS: '' };
    const install = () => run([command('sh'), installer], env, scratch);
    for (const platform of [['Darwin', 'x86_64'], ['Linux', 'aarch64'], ['MINGW64_NT', 'x86_64']]) {
      executable('uname', `process.stdout.write(process.argv[2] === '-s' ? '${platform[0]}' : '${platform[1]}');`);
      const result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Linux x64.*Apple Silicon/); assert.match(result.stderr, /Homebrew.*Nix/); assert.deepEqual(readdirSync(home), []);
    }
    executable('uname', "process.stdout.write(process.argv[2] === '-s' ? 'Linux' : 'x86_64');");
    executable('ldd', "process.stdout.write('ldd (GNU libc) 2.39\\n');");
    let result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Node\.js 24\.15/); assert.deepEqual(readdirSync(home), []);
    executable('node', "Object.defineProperty(process.versions, 'node', { value: '24.14.9' }); eval(process.argv[3]);");
    result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Node\.js 24\.15/); assert.deepEqual(readdirSync(home), []);
    rmSync(join(adapters, 'node')); symlinkSync(command('node'), join(adapters, 'node'));
    result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Git/); assert.deepEqual(readdirSync(home), []);
    rmSync(join(adapters, 'node'));
    for (const version of ['22.20.0', '24.14.9', '24.15.0', '25.0.0']) {
      executable('node', `Object.defineProperty(process.versions, 'node', { value: '${version}' }); eval(process.argv[3]);`);
      result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, version === '22.20.0' || version === '24.14.9' ? /Node\.js 24\.15/ : /Git/); assert.deepEqual(readdirSync(home), []);
    }
    executable('ldd', "process.stderr.write('musl libc\\n'); process.exitCode = 1;");
    result = install(); assert.notEqual(result.status, 0); assert.match(result.stderr, /glibc/); assert.deepEqual(readdirSync(home), []);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
