import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { packageBin } from './installed-package.js';

/** Verify distribution resources only after the single packaging test installs them. */
export function verifyInstalledHerdrMod(packageRoot: string, scratch: string): void {
  const home = join(scratch, 'herdr');
  mkdirSync(home); mkdirSync(join(home, 'mods/other'), { recursive: true });
  writeFileSync(join(home, 'mods/other/main.js'), 'other mod');
  const cli = packageBin(packageRoot);
  const call = (args: string[], appHome = home, expected = 0) => {
    const reply = spawnSync(process.execPath, [cli, '--json', ...args], { cwd: scratch, env: { ...process.env, NODE_OPTIONS: '', HERDR_APP_HOME: appHome }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(reply.status, expected, reply.stdout + reply.stderr);
    return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
      operation: Schema.optional(Schema.String), path: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String), dryRun: Schema.optional(Schema.Boolean),
    })), { onExcessProperty: 'ignore' })(reply.stdout || reply.stderr);
  };
  const step = (name: string, run: () => void) => {
    try { run(); }
    catch (cause) { throw new Error(`Installed Herdr mod check failed: ${name}`, { cause }); }
  };
  // @feature docs/feature/herdr-mod/README.md
  step('missing Herdr home and dry-run preserve the filesystem', () => {
    assert.equal(call(['herdr', 'install'], join(scratch, 'absent'), 1).error, 'HerdrNotFound');
    assert.equal(call(['--dry-run', 'herdr', 'install']).dryRun, true);
    assert.equal(existsSync(join(home, 'mods/concord')), false);
  });
  const target = join(home, 'mods/concord');
  const source = readFileSync(join(packageRoot, 'dist/herdr-mod/main.js'), 'utf8');
  step('install copies the current packaged entry and placement metadata', () => {
    const installed = call(['herdr', 'install']);
    assert.equal(installed.operation, 'herdr-install'); assert.equal(installed.path, target);
    assert.equal(readFileSync(join(target, 'main.js'), 'utf8'), source);
    assert.deepEqual(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(readFileSync(join(target, 'mod.json'), 'utf8')), { place: 'right', size: 760 });
  });
  step('reinstall repairs damaged entry bytes', () => {
    writeFileSync(join(target, 'main.js'), 'damaged'); call(['herdr', 'install']);
    assert.equal(readFileSync(join(target, 'main.js'), 'utf8'), source);
  });
  step('uninstall is repeatable and preserves unrelated mods', () => {
    assert.equal(call(['herdr', 'uninstall']).operation, 'herdr-uninstall');
    assert.equal(existsSync(target), false);
    assert.equal(readFileSync(join(home, 'mods/other/main.js'), 'utf8'), 'other mod');
    call(['herdr', 'uninstall']);
  });
  step('removed panel command is rejected', () => {
    const rejected = spawnSync(process.execPath, [cli, '--json', 'panel'], { cwd: scratch, env: { ...process.env, NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(rejected.status, 1);
  });
}
