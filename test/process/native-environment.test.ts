// 跨进程保证：原生模块与句柄——真实native映射在A、损坏B、修复B间按caller cwd和完整env隔离，关闭后句柄不可再用。
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { createMemoryHawdb, verifyHawdbArtifact } from '../../src/base/cache/index.ts';
import { hawdbTarget, nativeArtifactRoot } from '../../src/base/installation/index.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('native selection preserves caller cwd and isolates A, damaged B, repaired B and A', () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-native-environment-'));
  const source = join(nativeArtifactRoot(makeRuntimeEnvironment(process.cwd(), process.env)), hawdbTarget());
  const snapshots = ['a', 'b'].map(name => makeRuntimeEnvironment(join(directory, name), { XDG_CACHE_HOME: 'relative-cache' }));
  try {
    for (const runtime of snapshots) {
      const target = join(nativeArtifactRoot(runtime), hawdbTarget());
      assert.ok(target.startsWith(join(runtime.cwd, 'relative-cache') + '/'));
      cpSync(source, target, { recursive: true });
    }
    const [a, b] = snapshots;
    assert.ok(a && b);
    const memory = (runtime: typeof a) => {
      const database = createMemoryHawdb(runtime);
      try {
        assert.deepEqual(database.get('document_parse', ['caller']), []);
        database.put('document_parse', [{ key: 'caller', payload: runtime.cwd }]);
        assert.deepEqual(database.get('document_parse', ['caller']), [{ key: 'caller', payload: runtime.cwd }]);
      } finally { database.close(); }
      assert.throws(() => database.get('document_parse', ['caller']), { code: 'HawdbClosed' });
    };
    memory(a); memory(b);
    const binary = join(nativeArtifactRoot(b), hawdbTarget(), 'hawdb.node');
    const bytes = readFileSync(binary), before = statSync(binary);
    const damaged = Buffer.from(bytes);
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    // Replace a mapped binary; preserving size and mtime must not reuse old byte evidence.
    writeFileSync(binary + '.next', damaged);
    utimesSync(binary + '.next', before.atime, before.mtime);
    renameSync(binary + '.next', binary);
    assert.throws(() => verifyHawdbArtifact(b), { code: 'HawdbIncompatible' });
    assert.throws(() => createMemoryHawdb(b), { code: 'HawdbIncompatible' });
    memory(a);
    writeFileSync(binary + '.next', bytes); renameSync(binary + '.next', binary);
    verifyHawdbArtifact(b); memory(b); memory(a);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
