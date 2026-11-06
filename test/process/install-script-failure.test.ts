import assert from 'node:assert/strict';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('download, checksum and frozen installation failures preserve existing version bytes and links', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1');
  const before = readlinkSync(f.bin), previousManifest = readFileSync(join(f.root, '0.9.1/package.json'), 'utf8');
  for (const failure of [{ missing: true }, { corrupt: true }, { brokenLock: true }]) {
    f.publish('0.9.2', failure); const result = f.install('0.9.2'); assert.notEqual(result.status, 0, JSON.stringify(failure));
    assert.equal(readlinkSync(f.bin), before); assert.equal(readFileSync(join(f.root, '0.9.1/package.json'), 'utf8'), previousManifest);
    assert.deepEqual(readdirSync(f.root), ['0.9.1']);
    assert.equal(f.cli(['--version']).status, 0);
  }
  f.publish('0.9.1', { brokenLock: true }); const result = f.install('0.9.1'); assert.notEqual(result.status, 0);
  assert.equal(readlinkSync(f.bin), before); assert.equal(readFileSync(join(f.root, '0.9.1/package.json'), 'utf8'), previousManifest);
  assert.deepEqual(readdirSync(f.root), ['0.9.1']);
}));
