import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { run, withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('latest, explicit versions and custom links keep the two most recent successful installations', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1'); f.publish('0.9.2'); f.succeed('0.9.2');
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.2']);
  f.publish('0.9.3'); mkdirSync(join(f.release, 'tag')); writeFileSync(join(f.release, 'tag/v0.9.3'), ''); f.succeed();
  assert.deepEqual(readdirSync(f.root).sort(), ['0.9.2', '0.9.3']); assert.equal(readlinkSync(f.bin), join(f.root, '0.9.3', f.manifest.bin.concord));
  const custom = join(f.home, 'custom bin'); f.succeed('0.9.3', { CONCORD_INSTALL_DIR: custom });
  assert.equal(readlinkSync(join(custom, 'concord')), readlinkSync(f.bin)); assert.equal(lstatSync(f.bin).isSymbolicLink(), true);
  assert.equal(run([join(custom, 'concord'), '--version'], f.env, f.scratch).status, 0);
  f.publish('0.9.1'); f.succeed('0.9.1'); assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.3']);
  assert.equal(f.cli(['--version']).stdout.trim(), 'concord v0.9.1');
  assert.match(readFileSync(join(f.release, 'requests'), 'utf8'), /releases\/latest\n/);
}));
