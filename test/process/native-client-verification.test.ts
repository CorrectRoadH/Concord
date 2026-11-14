// 跨进程保证：运行环境——真实客户端校验官方产物时不加载动态库，损坏的清单、收据和库字节不能绕过校验。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { NativeArtifactSchema, nativeArtifactRoot, hawdbLibraryName, hawdbTarget } from '../../src/base/installation/index.ts';
import { verifyHawdbArtifact } from '../../src/base/cache/index.ts';
import { tmpdir } from '../support/temporary.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/feature/local-data-engine/architecture.md#cli-查询
test('client artifact verification does not load a native engine owned by the service', () => {
  const module = new URL('../../src/base/cache/hawdb-native.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as ffi from 'bun:ffi';
    import { mock } from 'bun:test';
    let loads = 0;
    mock.module('bun:ffi', () => ({ ...ffi, dlopen() { loads++; throw new Error('observed FFI boundary'); } }));
    const { verifyHawdbArtifact, validateHawdbArtifact, createMemoryHawdb } = await import(${JSON.stringify(module)});
    const runtime = { cwd: process.cwd(), env: { ...process.env } };
    verifyHawdbArtifact(runtime);
    validateHawdbArtifact(runtime);
    assert.equal(loads, 0);
    assert.throws(() => createMemoryHawdb(runtime), error => error.code === 'HawdbUnavailable');
    assert.equal(loads, 1, 'the same external boundary observes an actual engine load');
  `], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// @feature docs/engineering/build/architecture.md#原生绑定复用
test('official native receipts, manifests and library bytes all participate in client verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-native-verification-'));
  const isolated = makeRuntimeEnvironment(process.cwd(), { ...process.env, XDG_CACHE_HOME: join(root, 'cache') });
  const artifact = join(nativeArtifactRoot(isolated), hawdbTarget());
  const module = new URL('../../src/base/cache/index.ts', import.meta.url).href;
  const replace = (path: string, bytes: string | Buffer) => {
    writeFileSync(`${path}.next`, bytes);
    renameSync(`${path}.next`, path);
  };
  const rejects = () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { verifyHawdbArtifact, createMemoryHawdb } from ${JSON.stringify(module)};
      const runtime = { cwd: process.cwd(), env: { ...process.env } };
      for (const operation of [() => verifyHawdbArtifact(runtime), () => createMemoryHawdb(runtime)]) {
        assert.throws(operation, error => {
          assert.equal(error.code, 'HawdbUnavailable');
          assert.match(String(error), /HawdbIncompatible/u);
          return true;
        });
      }
    `], { encoding: 'utf8', timeout: 20_000, env: { ...isolated.env, NODE_OPTIONS: '' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  try {
    cpSync(join(nativeArtifactRoot(runtime), hawdbTarget()), artifact, { recursive: true });
    verifyHawdbArtifact(isolated);
    const receiptPath = join(artifact, 'artifact.json');
    const receipt = Schema.decodeUnknownSync(Schema.fromJsonString(NativeArtifactSchema), { onExcessProperty: 'error' })(readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.format, 'concord.native-artifact/v2');
    for (const field of ['upstreamManifestSha256', 'binarySha256'] as const) {
      replace(receiptPath, JSON.stringify({ ...receipt, [field]: '0'.repeat(64) }));
      rejects();
    }
    replace(receiptPath, JSON.stringify(receipt));
    for (const path of [join(artifact, 'manifest.json'), join(artifact, hawdbLibraryName(hawdbTarget()))]) {
      const bytes = readFileSync(path);
      replace(path, Buffer.concat([bytes, Buffer.from('\ninvalid bytes')]));
      rejects();
      replace(path, bytes);
      verifyHawdbArtifact(isolated);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
