import assert from 'node:assert/strict';
import { copyFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { executeQuery } from '../../src/app/index.ts';
import { clearCache, collectNativeTests } from '../../src/domain/tests/index.ts';
import { closeRepositoryCache, PersistentCache } from '../../src/base/cache/index.ts';
import { createConsumer } from './consumer.ts';
import { createDocument } from './operations.ts';
import { LocalRepository } from './repository.ts';
import { sourceRoot } from './source-consumer.ts';
import { configure, text } from './test-adapters-consumer-fixture.ts';

export const adapterConsumer = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(Effect.tryPromise(createConsumer), path => Effect.sync(() => rmSync(path, { recursive: true, force: true })));
  yield* Effect.tryPromise(async () => {
    const repo = (await LocalRepository.open(root));
    try {
      (await createDocument(repo, 'feature', { id: 'example', title: 'Example' }));
      (await createDocument(repo, 'issue', { id: 'problem', title: 'Problem' }));
    } finally { repo.close(); }
    text(root, 'package.json', '{"private":true,"type":"module"}');
    symlinkSync(join(sourceRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    text(root, '.gitignore', 'node_modules\n**/target/\n**/__pycache__/\n**/.pytest_cache/\n');
    copyFileSync(join(sourceRoot, 'test/fixtures/process-adapter.ts'), join(root, 'adapter.ts'));
    text(root, 'fixture.txt', 'original'); text(root, 'fixture.lock', 'locked'); text(root, 'mode.txt', 'green');
    text(root, 'test/sample.ts', '// @feature docs/feature/example/README.md\n// @name parameter-group\n// @issue docs/issues/problem.md\n');
    (await configure(root, [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['NODE_OPTIONS', 'PATH'], collectTimeoutMs: 1000, budgets: { reportFileBytes: 128 } }]));
  });
  return root;
});

export const adapterQuery = Effect.fn('adapterCache.query')(function* (root: string, name: 'check' | 'test.list') {
  const result = yield* executeQuery(root, { name, input: {} });
  return { ...result, value: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(result.value) };
});

export const adapterSuccess = Effect.fn('adapterCache.success')(function* (root: string, name: 'check' | 'test.list') {
  const result = yield* adapterQuery(root, name);
  assert.equal(result.exitCode, 0, `${name}\n${JSON.stringify(result.value)}`);
  return result.value;
});

const repository = (root: string) => Effect.acquireRelease(Effect.tryPromise(async () => (await LocalRepository.open(root))), repo => Effect.sync(() => {
  try { closeRepositoryCache(repo); } finally { repo.close(); }
}));

export const discoverAdapter = (root: string) => Effect.scoped(Effect.gen(function* () {
  const repo = yield* repository(root);
  return yield* collectNativeTests(repo, ['test/sample.ts']);
}));

export const clearAdapterCache = (root: string) => Effect.scoped(Effect.gen(function* () {
  const repo = yield* repository(root);
  return yield* Effect.sync(() => clearCache(repo));
}));

export const corruptObservation = (root: string) => Effect.scoped(Effect.gen(function* () {
  const repo = yield* repository(root);
  yield* Effect.sync(() => repo.snapshot(() => PersistentCache.repository(repo).put('annotation_cache', [{ key: 'native-manifest/v1/external', payload: '{broken' }])));
}));
