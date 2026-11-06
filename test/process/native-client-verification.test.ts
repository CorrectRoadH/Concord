import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// @feature docs/feature/local-data-engine/architecture.md#cli-查询
test('client artifact verification does not load a native engine owned by the service', () => {
  const module = new URL('../../src/base/cache/hawdb-native.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--no-addons', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { verifyHawdbArtifact, validateHawdbArtifact } from ${JSON.stringify(module)};
    verifyHawdbArtifact();
    assert.throws(() => validateHawdbArtifact(), error => error.code === 'HawdbUnavailable');
  `], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
