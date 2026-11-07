import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { installationIdentity } from '../../src/base/installation/identity-cache.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/cross-platform-release/README.md
test('installation cache binds runtime identity and safe dependency links', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-bun-identity-'));
  try {
    const root = join(scratch, 'app');
    mkdirSync(join(root, '.store/tool'), { recursive: true });
    writeFileSync(join(root, '.store/tool/index.js'), 'first');
    symlinkSync('.store/tool', join(root, 'tool'));
    const runtime = makeRuntimeEnvironment(scratch, { XDG_CACHE_HOME: join(scratch, 'cache') });
    const trees = [{ root, prefix: 'app', accept: () => true, linkRoot: root }];
    const first = installationIdentity(root, trees, [['bun', 'first']], runtime);
    assert.equal(installationIdentity(root, trees, [['bun', 'first']], runtime), first);
    const nextRuntime = installationIdentity(root, trees, [['bun', 'second']], runtime);
    assert.notEqual(nextRuntime, first);
    writeFileSync(join(root, '.store/tool/index.js'), 'second');
    assert.notEqual(installationIdentity(root, trees, [['bun', 'second']], runtime), nextRuntime);
    symlinkSync('..', join(root, '.store/escape'));
    assert.throws(() => installationIdentity(root, trees, [], runtime), /cycle/);
    rmSync(join(root, '.store/escape'));
    symlinkSync('../outside', join(root, 'escape'));
    writeFileSync(join(scratch, 'outside'), 'outside');
    assert.throws(() => installationIdentity(root, trees, [], runtime), /escapes/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
