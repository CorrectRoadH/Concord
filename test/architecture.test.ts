import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { dependencyViolations, inspectArchitecture, inspectTestLayout } from './support/architecture.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

// @feature docs/engineering/code/README.md#模块与文件
test('source index files only export their module interfaces', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  assert.deepEqual((await inspectArchitecture(root)).invalid.filter(item => item.code === 'IndexImplementation'), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('source import and export graphs obey module exits, layers, domain order and composition roots', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const audit = (await inspectArchitecture(root));
  assert.deepEqual(dependencyViolations(audit), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('model, domain and application code access platform capabilities through services', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  assert.deepEqual((await inspectArchitecture(root)).platform, []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('domain and application consumers cannot open persistent cache handles or select their own access mode', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const audit = (await inspectArchitecture(root));
  assert.deepEqual(audit.edges.filter(edge => /^src\/(?:domain|app)\//u.test(edge.from)
    && edge.to === 'src/base/cache/index.ts'
    && edge.bindings.some(name => name === 'openHawdb' || name === 'withPersistentCache')), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('CLI tests use the command program and process tests declare their cross-process guarantee', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  assert.deepEqual((await inspectTestLayout(root)), []);
}))));
