import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { makeKnowledgeSearchOwner, readAnalysisObservations } from '../../src/app/index.ts';
import { HawdbFailure, PersistentCache, type HawdbNamespace } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { scanCode } from '../../src/domain/code/index.ts';
import { readNativeObservations, scanAnnotations } from '../../src/domain/tests/index.ts';
import { ConcordError, failure, objectDigest, type AnalysisObservation } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);

async function fixture() {
  const root = await createConsumer();
  writeProjectConfig(root, {
    testRoots: ['test'], sourceRoots: ['src'],
    testAdapters: [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], envNames: [], collectTimeoutMs: 1000 }],
  });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'src/sample.ts'), 'export const sample = true;\n');
  writeFileSync(join(root, 'test/sample.py'), '# @feature docs/feature/sample/README.md\n');
  writeFileSync(join(root, 'adapter.ts'), 'export {};\n');
  return root;
}

const readers = {
  annotation: (repo: LocalRepository) => scanAnnotations(repo),
  code: (repo: LocalRepository) => scanCode(repo, undefined, runtime),
  analysis: (repo: LocalRepository) => readAnalysisObservations(repo, runtime),
  native: async (repo: LocalRepository) => readNativeObservations(repo),
};

for (const [name, read] of Object.entries(readers)) {
  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
  test(`${name} consumer propagates a cache read failure without writes or a second source scan`, async () => {
    const root = await fixture();
    const repo = await LocalRepository.open(root);
    const access = PersistentCache.repository(repo);
    const fault = new HawdbFailure('HawdbBusy', 'selected cache is owned elsewhere', { cause: new Error('engine lock busy') });
    const get = mock.method(access, 'get', () => { throw fault; });
    const put = mock.method(access, 'put');
    const source = mock.method(repo, 'read');
    try {
      await assert.rejects(read(repo), cause => cause === fault);
      assert.equal(get.mock.callCount(), 1);
      assert.equal(put.mock.callCount(), 0);
      if (name === 'annotation' || name === 'code') assert.equal(source.mock.callCount(), 1);
      else assert.equal(source.mock.callCount(), 0);
    } finally { get.mock.restore(); put.mock.restore(); source.mock.restore(); repo.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const [name, read] of Object.entries({ annotation: readers.annotation, code: readers.code })) {
  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
  test(`${name} consumer propagates a cache write failure instead of a successful scan`, async () => {
    const root = await fixture();
    const repo = await LocalRepository.open(root);
    const access = PersistentCache.repository(repo);
    const get = mock.method(access, 'get', () => []);
    const fault = new HawdbFailure('HawdbLimit', 'selected cache write exceeded its budget');
    const put = mock.method(access, 'put', () => { throw fault; });
    try {
      await assert.rejects(read(repo), cause => cause === fault);
      assert.equal(put.mock.callCount(), 1);
    } finally { get.mock.restore(); put.mock.restore(); repo.close(); rmSync(root, { recursive: true, force: true }); }
  });

  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
  test(`${name} consumer rejects malformed cached parses before rescanning sources`, async () => {
    const root = await fixture();
    const repo = await LocalRepository.open(root);
    const access = PersistentCache.repository(repo);
    const put = mock.method(access, 'put');
    try {
      const wrongSource = name === 'annotation' ? { cases: [], findings: [], files: [{ path: 'another-source.py', digest: 'wrong-generation' }] }
        : { codes: [], findings: [{ code: 'ParseFinding', path: 'another-source.ts', message: 'wrong source' }] };
      for (const payload of ['{broken', '{}', JSON.stringify({ ...wrongSource, digest: objectDigest(wrongSource) })]) {
        const get = mock.method(access, 'get', (_namespace: HawdbNamespace, keys: readonly string[]) => [{ key: keys[0]!, payload }]);
        const source = mock.method(repo, 'read');
        try {
          await assert.rejects(read(repo), error => error instanceof ConcordError && error.code === 'InvalidData');
          assert.equal(source.mock.callCount(), 1);
          assert.equal(put.mock.callCount(), 0);
        } finally { get.mock.restore(); source.mock.restore(); }
      }
    } finally { put.mock.restore(); repo.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('analysis observations reject malformed JSON, schema, identity and completeness without overwriting rows', async () => {
  const root = await fixture();
  const repo = await LocalRepository.open(root);
  const access = PersistentCache.repository(repo);
  const valid: AnalysisObservation = { value: { analyzer: 'typescript', profile: 'test', encoding: 'utf-16', locators: [], dependencies: [], gaps: [] }, inputs: 'test-inputs', observedAt: '2026-11-14T00:00:00Z', complete: true, current: true, gaps: [] };
  const corrupt = ['{broken', '{}', JSON.stringify({ ...valid, value: { ...valid.value, analyzer: 'wrong' } }), JSON.stringify({ ...valid, complete: false })];
  const put = mock.method(access, 'put');
  try {
    for (const payload of corrupt) {
      const get = mock.method(access, 'get', (_namespace: HawdbNamespace, keys: readonly string[]) => [{ key: keys[0]!, payload }]);
      try { await assert.rejects(readAnalysisObservations(repo, runtime), error => error instanceof ConcordError && error.code === 'InvalidData'); }
      finally { get.mock.restore(); }
      assert.equal(put.mock.callCount(), 0);
    }
    const absent = mock.method(access, 'get', () => []);
    try { assert.deepEqual(await readAnalysisObservations(repo, runtime), []); assert.deepEqual(readNativeObservations(repo), []); }
    finally { absent.mock.restore(); }
  } finally { put.mock.restore(); repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('native observations reject damaged input scopes and preserve valid stale observations', async () => {
  const root = await fixture();
  const repo = await LocalRepository.open(root);
  const access = PersistentCache.repository(repo);
  const observation = {
    value: { cases: [], capabilities: { realCollection: true, leaf: true, parameterGroups: false, range: false, tags: false, rangeTrivia: false }, completeness: { complete: false, gaps: ['ExternalInputUnknown'] } },
    inputs: 'previous-source-generation', observedAt: '2026-11-14T00:00:00Z', complete: false, current: true, gaps: ['ExternalInputUnknown'],
  };
  const scope = { inputs: 'wrong-observation-inputs', members: [], excluded: [], versions: { framework: 'test', runtime: 'test' } };
  const put = mock.method(access, 'put');
  try {
    for (const payload of ['{broken', '{}', JSON.stringify(scope)]) {
      const get = mock.method(access, 'get', (_namespace: HawdbNamespace, keys: readonly string[]) => [{ key: keys[0]!, payload: keys[0]!.startsWith('native-manifest/') ? JSON.stringify(observation) : payload }]);
      try {
        assert.throws(() => repo.snapshot(() => readNativeObservations(repo)), error => error instanceof ConcordError && ['AdapterProtocolInvalid', 'InvalidData'].includes(error.code));
        assert.equal(put.mock.callCount(), 0);
      } finally { get.mock.restore(); }
    }
    const get = mock.method(access, 'get', (_namespace: HawdbNamespace, keys: readonly string[]) => keys[0]!.startsWith('native-manifest/') ? [{ key: keys[0]!, payload: JSON.stringify(observation) }] : []);
    try {
      const stale = repo.snapshot(() => readNativeObservations(repo));
      assert.equal(stale.length, 1);
      assert.equal(stale[0]?.observation.current, false);
      assert.equal(stale[0]?.inputScope, undefined);
      assert.equal(put.mock.callCount(), 0);
    } finally { get.mock.restore(); }
  } finally { put.mock.restore(); repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('search propagates the selected backend failure without trying memory or a source fallback', async () => {
  const root = await fixture();
  const repo = await LocalRepository.open(root);
  try {
    for (const code of ['HawdbBusy', 'HawdbLimit', 'HawdbCancelled', 'HawdbIncompatible'] as const) {
      const fault = new HawdbFailure(code, 'selected backend failed', { cause: new Error('engine cause') });
      const modes: boolean[] = [];
      const owner = makeKnowledgeSearchOwner({
        search: async input => { modes.push(input.memory); throw fault; },
        discard: async () => { throw new Error('unexpected alternate operation'); },
      });
      await assert.rejects(owner.search(repo, 'memory', 'needle'), error => error === fault);
      assert.deepEqual(modes, [false]);
      const exposed = failure(fault);
      assert.equal(exposed.code, code);
      assert.equal(exposed.cause, fault);
    }
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
