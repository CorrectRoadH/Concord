import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { packageBin } from './installed-package.js';

/** Exercise the packaged CLI against private homes, replacing only the external Herdr command. */
export function verifyInstalledHerdrMod(packageRoot: string, scratch: string): void {
  const home = join(scratch, 'herdr'), userHome = join(scratch, 'user'), bin = join(scratch, 'bin');
  mkdirSync(join(home, 'mods/other'), { recursive: true }); mkdirSync(bin);
  mkdirSync(join(userHome, '.config/herdr-app/mods/concord'), { recursive: true });
  writeFileSync(join(userHome, '.config/herdr-app/mods/concord/main.js'), 'default home is not selected');
  writeFileSync(join(home, 'mods/other/main.js'), 'other mod');
  writeFileSync(join(home, 'settings.json'), '{"theme":"mine"}');
  mkdirSync(join(home, 'layouts')); writeFileSync(join(home, 'layouts/custom.json'), '{}');
  // This executable is an external-host fixture. All copying, ownership checks and receipts run in Concord.
  const executable = join(bin, 'herdr-app'), calls = join(scratch, 'host-calls.jsonl');
  writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');
fs.appendFileSync(process.env.HERDR_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === '--version') { console.log('herdr-app test host'); }
else if (process.argv[2] === 'check') {
  console.log('host checked ' + process.argv[3]);
  if (process.env.HERDR_TEST_CHECK_FAIL === '1') { console.error('host rejected mod'); process.exitCode = 7; }
} else { process.exitCode = 2; }
`); chmodSync(executable, 0o755);
  const cli = packageBin(packageRoot);
  const invoke = (args: string[], appHome = home, command = false, failCheck = false) => spawnSync(process.execPath, [cli, ...args], {
    cwd: scratch, env: { ...process.env, NODE_OPTIONS: '', HOME: userHome, HERDR_APP_HOME: appHome,
      PATH: command ? bin : '', HERDR_TEST_CALLS: calls, HERDR_TEST_CHECK_FAIL: failCheck ? '1' : '0' },
    encoding: 'utf8', timeout: 30_000,
  });
  const call = (args: string[], appHome = home, expected = 0, command = false, failCheck = false) => {
    const reply = invoke(['--json', ...args], appHome, command, failCheck);
    assert.equal(reply.status, expected, reply.stdout + reply.stderr);
    return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
      operation: Schema.optional(Schema.String), path: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String), message: Schema.optional(Schema.String), dryRun: Schema.optional(Schema.Boolean),
      updated: Schema.optional(Schema.Boolean), absent: Schema.optional(Schema.Boolean), openHerdr: Schema.optional(Schema.Boolean),
      details: Schema.optional(Schema.Struct({ output: Schema.String })),
    })), { onExcessProperty: 'ignore' })(reply.stdout || reply.stderr);
  };
  const step = (name: string, run: () => void) => {
    try { run(); }
    catch (cause) { throw new Error(`Installed Herdr mod check failed: ${name}`, { cause }); }
  };
  const target = join(home, 'mods/concord'), absent = join(scratch, 'absent');
  const source = readFileSync(join(packageRoot, 'dist/herdr-mod/main.js'), 'utf8');
  // @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
  step('missing command and selected config return the installer without writing', () => {
    const missing = call(['herdr', 'install'], absent, 1);
    assert.equal(missing.error, 'HerdrNotFound');
    assert.match(missing.message!, /curl -fsSL https:\/\/releases\.herdr\.dev\/app\/install\.sh \| sh/u);
    assert.match(missing.message!, /concord herdr install/u);
    assert.equal(existsSync(absent), false); assert.equal(existsSync(calls), false);
    assert.equal(call(['--dry-run', 'herdr', 'install']).dryRun, true);
    assert.equal(existsSync(target), false);
  });
  step('install copies current package bytes and placement metadata to HERDR_APP_HOME', () => {
    const installed = call(['herdr', 'install']);
    assert.equal(installed.operation, 'herdr-install'); assert.equal(installed.path, target);
    assert.equal(readFileSync(join(target, 'main.js'), 'utf8'), source);
    assert.equal(readFileSync(join(target, 'mod.json'), 'utf8'), readFileSync(join(packageRoot, 'dist/herdr-mod/mod.json'), 'utf8'));
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ minimumConcordVersion: Schema.String })))(readFileSync(join(target, 'mod.json'), 'utf8'));
    const version = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
    assert.equal(manifest.minimumConcordVersion, version);
    assert.equal(readFileSync(join(userHome, '.config/herdr-app/mods/concord/main.js'), 'utf8'), 'default home is not selected');
  });
  step('reinstall repairs damaged bytes and prints Updated', () => {
    writeFileSync(join(target, 'main.js'), 'damaged');
    const reply = invoke(['herdr', 'install']);
    assert.equal(reply.status, 0, reply.stdout + reply.stderr); assert.match(reply.stdout, /^Updated Concord mod:/u);
    assert.equal(call(['herdr', 'install']).updated, true);
    assert.equal(readFileSync(join(target, 'main.js'), 'utf8'), source);
  });
  step('uninstall is repeatable and preserves unrelated mods and settings', () => {
    assert.equal(call(['herdr', 'uninstall']).operation, 'herdr-uninstall'); assert.equal(existsSync(target), false);
    assert.equal(call(['herdr', 'uninstall']).absent, true);
    const reply = invoke(['herdr', 'uninstall'], absent);
    assert.equal(reply.status, 0, reply.stderr); assert.equal(reply.stdout.trim(), 'Concord mod is not installed');
    assert.equal(existsSync(absent), false);
    assert.equal(readFileSync(join(home, 'mods/other/main.js'), 'utf8'), 'other mod');
    assert.equal(readFileSync(join(home, 'settings.json'), 'utf8'), '{"theme":"mine"}');
    assert.equal(readFileSync(join(home, 'layouts/custom.json'), 'utf8'), '{}');
  });
  step('a present command creates its first configuration and is checked after installation', () => {
    const reply = invoke(['herdr', 'install'], absent, true);
    assert.equal(reply.status, 0, reply.stdout + reply.stderr);
    assert.match(reply.stdout, /^Installed Concord mod:/u); assert.match(reply.stdout, /Open Herdr/u);
    const installedPath = join(absent, 'mods/concord');
    assert.equal(readFileSync(join(installedPath, 'main.js'), 'utf8'), source);
    const history = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
    assert.deepEqual(history, [['--version'], ['check', installedPath]]);
  });
  step('a failed real child command exposes both output streams and retains installed files', () => {
    const failed = call(['herdr', 'install'], absent, 1, true, true);
    assert.equal(failed.error, 'HerdrModCheckFailed');
    assert.match(failed.details!.output, /host checked/u); assert.match(failed.details!.output, /host rejected mod/u);
    assert.equal(readFileSync(join(absent, 'mods/concord/main.js'), 'utf8'), source);
    assert.deepEqual(readdirSync(join(absent, 'mods/concord')).sort(), ['NOTICE.txt', 'main.js', 'mod.json']);
    call(['herdr', 'uninstall'], absent);
  });
  step('non-Concord content and symlinks are refused without damage', () => {
    mkdirSync(target); writeFileSync(join(target, 'main.js'), 'not Concord');
    assert.equal(call(['herdr', 'install'], home, 1).error, 'HerdrModPathOccupied');
    assert.equal(readFileSync(join(target, 'main.js'), 'utf8'), 'not Concord'); rmSync(target, { recursive: true });
    symlinkSync(join(home, 'mods/other'), target);
    for (const operation of ['install', 'uninstall']) assert.equal(call(['herdr', operation], home, 1).error, 'HerdrModPathOccupied');
    assert.equal(readFileSync(join(home, 'mods/other/main.js'), 'utf8'), 'other mod'); rmSync(target);
  });
  step('removed panel command is rejected', () => {
    const rejected = invoke(['--json', 'panel']); assert.equal(rejected.status, 1);
  });
}
