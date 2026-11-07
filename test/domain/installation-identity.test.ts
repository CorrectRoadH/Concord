import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { installationIdentity } from '../../src/base/installation/identity-cache.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-data-engine/README.md
test('installation fingerprints detect ctime, inode, membership and native replacement', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-identity-')), root = join(scratch, 'package');
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(scratch, 'cache');
  const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
  mkdirSync(join(root, 'native'), { recursive: true });
  writeFileSync(join(root, 'a.js'), 'export const a = 1;\n'); writeFileSync(join(root, 'native/test.node'), 'native-1');
  const trees = [{ root, prefix: '', accept: (name: string) => /\.(?:js|node)$/u.test(name) }];
  try {
    const initial = installationIdentity(root, trees, [], runtime);
    assert.equal(installationIdentity(root, trees, [], runtime), initial);
    const before = statSync(join(root, 'a.js'));
    writeFileSync(join(root, 'a.js'), 'export const a = 2;\n'); utimesSync(join(root, 'a.js'), before.atime, before.mtime);
    const changed = installationIdentity(root, trees, [], runtime); assert.notEqual(changed, initial);
    writeFileSync(join(root, 'replacement'), readFileSync(join(root, 'a.js'))); renameSync(join(root, 'replacement'), join(root, 'a.js'));
    assert.equal(installationIdentity(root, trees, [], runtime), changed);
    writeFileSync(join(root, 'b.js'), 'export {};\n'); assert.notEqual(installationIdentity(root, trees, [], runtime), changed);
    const withMember = installationIdentity(root, trees, [], runtime);
    writeFileSync(join(root, 'native/test.node'), 'native-2'); assert.notEqual(installationIdentity(root, trees, [], runtime), withMember);
    const valid = installationIdentity(root, trees, [], runtime);
    const cache = join(scratch, 'cache/concord/installation-identities');
    writeFileSync(join(cache, readdirSync(cache)[0]!), '{broken');
    assert.equal(installationIdentity(root, trees, [], runtime), valid);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(cache, readdirSync(cache)[0]!), 'utf8')), 'corrupt identity metadata is replaced with a valid cache record');
  } finally {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previous;
    rmSync(scratch, { recursive: true, force: true });
  }
});
