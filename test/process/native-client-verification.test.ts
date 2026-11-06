// 跨进程保证：运行环境——真实--no-addons客户端只验证artifact而不加载引擎，hook工件需显式身份并保持摘要校验。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { nativeArtifactRoot, hawdbTarget } from '../../src/base/installation/index.ts';
import { tmpdir } from '../support/temporary.ts';
import { Effect } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/feature/local-data-engine/architecture.md#cli-查询
test('client artifact verification does not load a native engine owned by the service', () => {
  const module = new URL('../../src/base/cache/hawdb-native.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--no-addons', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { verifyHawdbArtifact, validateHawdbArtifact } from ${JSON.stringify(module)};
    const runtime = { cwd: process.cwd(), env: { ...process.env } };
    verifyHawdbArtifact(runtime);
    assert.throws(() => validateHawdbArtifact(runtime), error => error.code === 'HawdbUnavailable');
  `], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// @feature docs/engineering/build/architecture.md#故障注入产物
test('source native hooks require explicit matching identity and preserve digest verification', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-native-hooks-'));
  const cache = join(root, 'cache');
  const artifact = join(cache, 'concord/native', basename(nativeArtifactRoot(runtime)), hawdbTarget());
  const module = new URL('../../src/base/cache/index.ts', import.meta.url).href;
  const env = { ...process.env, XDG_CACHE_HOME: cache, CONCORD_NATIVE_TEST_HOOKS: undefined };
  const invoke = (hooks: string | undefined, body: string) => spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { hawdbIdentity, createMemoryHawdb } from ${JSON.stringify(module)};
    const runtime = { cwd: process.cwd(), env: { ...process.env } };
    ${body}
  `], { encoding: 'utf8', env: { ...env, CONCORD_NATIVE_TEST_HOOKS: hooks } });
  const rejects = (hooks: string | undefined) => {
    const result = invoke(hooks, "assert.throws(() => hawdbIdentity(runtime), error => error.code === 'HawdbIncompatible');");
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  try {
    const build = spawnSync(process.execPath, ['scripts/build-native.ts', '--test-hooks'], { encoding: 'utf8', env });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const manifestPath = join(artifact, 'artifact.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    assert.equal(manifest.testHooks, true);
    rejects(undefined);
    const accepted = invoke('1', `
      const db = createMemoryHawdb(runtime);
      try {
        process.env.CONCORD_HAWDB_TEST_FAIL_AFTER_FIRST = '1';
        assert.throws(() => db.put('document_parse', [{ key: 'first', payload: '1' }, { key: 'second', payload: '2' }]), error => error.code === 'HawdbUnavailable');
        delete process.env.CONCORD_HAWDB_TEST_FAIL_AFTER_FIRST;
        assert.deepEqual(db.scan('document_parse'), []);
        db.put('document_parse', [{ key: 'committed', payload: 'value' }]);
        assert.deepEqual(db.scan('document_parse'), [{ key: 'committed', payload: 'value' }]);
      } finally { db.close(); }
    `);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    for (const field of ['sourceDigest', 'cargoLockDigest', 'binarySha256', 'noticesSha256']) {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, [field]: '0'.repeat(64) }));
      rejects('1');
    }
    cpSync(join(nativeArtifactRoot(runtime), hawdbTarget()), artifact, { recursive: true });
    rejects('1');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
