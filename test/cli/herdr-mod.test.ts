import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { installedConcordCli } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

// @feature docs/feature/herdr-mod/README.md
test('packaged CLI installs current built mod assets, replaces files and removes only its own directory', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-herdr-install-'));
  const home = join(scratch, 'herdr'); mkdirSync(home); mkdirSync(join(home, 'mods/other'), { recursive: true });
  writeFileSync(join(home, 'mods/other/main.js'), 'other mod');
  const cli = installedConcordCli();
  const call = (args: string[], appHome = home, expected = 0) => {
    const reply = spawnSync(process.execPath, [cli, '--json', ...args], { cwd: scratch, env: { ...process.env, HERDR_APP_HOME: appHome }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(reply.status, expected, reply.stdout + reply.stderr);
    return JSON.parse(reply.stdout || reply.stderr) as { operation: string; path: string; error?: string; dryRun?: boolean };
  };
  try {
    assert.equal(call(['herdr', 'install'], join(scratch, 'absent'), 1).error, 'HerdrNotFound');
    assert.equal(call(['--dry-run', 'herdr', 'install']).dryRun, true);
    assert.equal(existsSync(join(home, 'mods/concord')), false);
    const installed = call(['herdr', 'install']);
    assert.equal(installed.operation, 'herdr-install'); assert.equal(installed.path, join(home, 'mods/concord'));
    const source = readFileSync(join(installed.path, 'main.js'), 'utf8');
    assert.equal(source, readFileSync('dist/herdr-mod/main.js', 'utf8'));
    assert.deepEqual(JSON.parse(readFileSync(join(installed.path, 'mod.json'), 'utf8')), { place: 'right', size: 760 });
    writeFileSync(join(installed.path, 'main.js'), 'damaged'); call(['herdr', 'install']);
    assert.equal(readFileSync(join(installed.path, 'main.js'), 'utf8'), source);
    assert.equal(call(['herdr', 'uninstall']).operation, 'herdr-uninstall');
    assert.equal(existsSync(installed.path), false);
    assert.equal(readFileSync(join(home, 'mods/other/main.js'), 'utf8'), 'other mod');
    call(['herdr', 'uninstall']);
    const rejected = spawnSync(process.execPath, [cli, '--json', 'panel'], { cwd: scratch, encoding: 'utf8', timeout: 30_000 });
    assert.equal(rejected.status, 1);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
