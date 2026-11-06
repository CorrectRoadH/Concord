import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('a failed atomic link switch removes the candidate and preserves the working installation', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1');
  const before = readlinkSync(f.bin), previousManifest = readFileSync(join(f.root, '0.9.1/package.json'), 'utf8');
  f.publish('0.9.2'); const blocked = join(f.home, 'blocked'); mkdirSync(join(blocked, 'concord'), { recursive: true });
  const result = f.install('0.9.2', { CONCORD_INSTALL_DIR: blocked }); assert.notEqual(result.status, 0); assert.match(result.stderr, /switch the Concord link/);
  assert.equal(readlinkSync(f.bin), before); assert.equal(readFileSync(join(f.root, '0.9.1/package.json'), 'utf8'), previousManifest);
  assert.deepEqual(readdirSync(f.root), ['0.9.1']); assert.deepEqual(readdirSync(blocked), ['concord']);
  assert.equal(f.cli(['--version']).status, 0);
}));
