import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Schema } from 'effect';
import { archiveEnvironment } from './archive-environment.ts';
import { decodeNativeArtifact, hawdbTarget } from '../../src/base/installation/index.ts';

export function verifyArchiveContents(root: string): void {
  const within = (path: string) => { const name = relative(root, path); return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name); };
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), entry = lstatSync(path);
      assert.ok(within(realpathSync(path)), `Archive dependency escapes its root: ${path}`);
      if (entry.isSymbolicLink()) assert.equal(isAbsolute(readlinkSync(path)), false, `Absolute archive link: ${path}`);
      else if (entry.isDirectory()) walk(path);
    }
  };
  walk(root);
  for (const path of ['bin/concord', 'runtime/node', 'runtime/rg', 'licenses/NODE-LICENSE', 'licenses/RIPGREP-COPYING', 'licenses/RIPGREP-LICENSE-MIT', 'app/dist/web/index.html', 'app/dist/herdr-mod/main.js', 'app/dist/herdr-mod/mod.json', 'app/dist/herdr-mod/NOTICE.txt']) assert.ok(readFileSync(join(root, path)).length > 0, path);
  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ dependencies: Schema.Record(Schema.String, Schema.String), devDependencies: Schema.Record(Schema.String, Schema.String) })))(readFileSync(join(root, 'app/package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies)) assert.ok(existsSync(join(root, 'app/node_modules', name, 'package.json')), `Missing production dependency ${name}`);
  for (const name of Object.keys(manifest.devDependencies)) if (!(name in manifest.dependencies)) assert.equal(existsSync(join(root, 'app/node_modules', name, 'package.json')), false, `Development dependency shipped at runtime: ${name}`);
  assert.ok(readdirSync(join(root, 'licenses/dependencies')).length > 0, 'production dependencies need redistribution licenses');
  const native = decodeNativeArtifact(JSON.parse(readFileSync(join(root, 'app/dist/native', hawdbTarget(), 'artifact.json'), 'utf8')));
  assert.equal(native.portable, true, 'local Nix artifacts must not enter release archives');
  assert.equal(Boolean(native.testHooks), false);
  assert.equal(existsSync(join(root, 'app/src')), false);
  assert.equal(existsSync(join(root, 'app/dist/web/node_modules')), false);
  assert.doesNotMatch(readFileSync(join(root, 'bin/concord'), 'utf8'), /LD_LIBRARY_PATH/u);
}

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#verify
export async function verifyArchiveRuntime(root: string, scratch: string): Promise<void> {
  const { env, marker } = archiveEnvironment(join(scratch, 'restricted-bin'));
  const workspace = join(scratch, 'runtime-project'); mkdirSync(workspace);
  const cli = join(root, 'bin/concord');
  const run = (args: readonly string[]) => {
    const result = spawnSync(cli, args, { cwd: workspace, env, encoding: 'utf8', timeout: 45_000 });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stdout}${result.stderr}${String(result.error)}`);
    return result.stdout;
  };
  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(readFileSync(join(root, 'app/package.json'), 'utf8'));
  assert.equal(run(['--version']).trim(), `concord v${manifest.version}`); run(['--help']);
  const node = spawnSync(join(root, 'runtime/node'), ['--version'], { cwd: workspace, env, encoding: 'utf8' });
  assert.equal(node.status, 0, node.stderr);
  assert.equal(node.stdout.trim(), `v${readFileSync(new URL('../../.node-version', import.meta.url), 'utf8').trim()}`);
  execFileSync(join(env.PATH!, 'git'), ['init', '-q', workspace], { env });
  const call = (args: readonly string[]) => run(['--root', workspace, '--json', '--server=command', ...args]);
  try {
    call(['init', '--docs-only', '--yes']);
    const checked = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(true), complete: Schema.Literal(true) })))(call(['check']));
    assert.deepEqual(checked, { ok: true, complete: true });
    const Cache = Schema.fromJsonString(Schema.Struct({ cache: Schema.Struct({ status: Schema.String }) }));
    call(['cache', 'clear']);
    assert.equal(Schema.decodeUnknownSync(Cache)(call(['cache', 'rebuild'])).cache.status, 'miss');
    assert.equal(Schema.decodeUnknownSync(Cache)(call(['test', 'list'])).cache.status, 'hit');
    // A public launcher symlink must preserve archive ownership and all arguments.
    const linked = join(scratch, 'linked-concord'); symlinkSync(cli, linked);
    assert.equal(execFileSync(linked, ['--version'], { cwd: workspace, env, encoding: 'utf8' }).trim(), `concord v${manifest.version}`);
  } finally { run(['--root', workspace, 'server', 'stop']); }
  assert.equal(existsSync(join(workspace, '.git/concord/server/current.json')), false);
  assert.equal(existsSync(marker), false, 'Archive invoked a PATH node, rg or pnpm probe');
}
