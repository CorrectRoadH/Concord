import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { archivePartInput, cachedArchivePart } from '../../scripts/application-cache.ts';

// @feature docs/engineering/build/architecture.md#共享构建缓存
test('archive part keys isolate source and resources while including their actual producer and tool inputs', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-part-inputs-' });
  for (const file of ['src/main.ts', 'docs/example.md', 'scripts/build.ts', 'lock.yaml']) {
    yield* fs.makeDirectory(join(root, file, '..'), { recursive: true });
    yield* fs.writeFileString(join(root, file), file);
  }
  const code = () => archivePartInput(root, ['src', 'scripts/build.ts', 'lock.yaml'], { compiler: 'pinned' });
  const resources = () => archivePartInput(root, ['docs', 'scripts/build.ts']);
  const originalCode = yield* code(), originalResources = yield* resources();
  yield* fs.writeFileString(join(root, 'docs/untracked.md'), 'untracked resource');
  assert.equal(yield* code(), originalCode);
  assert.notEqual(yield* resources(), originalResources);
  const changedResources = yield* resources();
  yield* fs.writeFileString(join(root, 'src/main.ts'), 'changed source');
  assert.notEqual(yield* code(), originalCode);
  assert.equal(yield* resources(), changedResources);
  const changedCode = yield* code();
  yield* fs.writeFileString(join(root, 'scripts/build.ts'), 'changed producer');
  assert.notEqual(yield* code(), changedCode);
  assert.notEqual(yield* resources(), changedResources);
  assert.notEqual(yield* archivePartInput(root, ['src', 'scripts/build.ts', 'lock.yaml'], { compiler: 'other' }), yield* code());
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/build/architecture.md#共享构建缓存
test('archive parts publish once, preserve leased bytes and reject corruption and failed publication', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-part-cache-' });
  let builds = 0;
  const compile = (directory: string) => Effect.gen(function*() {
    builds++;
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(join(directory, 'payload'), 'immutable');
  });
  const use = (input: string) => cachedArchivePart('test', input, compile, undefined, root);
  const first = yield* Effect.scoped(use('first'));
  assert.equal(yield* Effect.scoped(use('first')), first);
  assert.equal(builds, 1);
  const copy = join(root, 'private');
  yield* fs.copy(first, copy);
  yield* fs.writeFileString(join(copy, 'payload'), 'target-specific relocation');
  assert.equal(yield* fs.readFileString(join(first, 'payload')), 'immutable');
  const held = yield* use('held');
  for (let index = 0; index < 5; index++) yield* Effect.scoped(use(`next-${index}`));
  assert.equal(yield* fs.exists(held), true, 'prune must skip an active part lease');
  yield* fs.writeFileString(join(held, 'payload'), 'corrupt');
  // Release the test lease before asking the same digest to validate its bytes.
  const corrupt = yield* Effect.scoped(use('next-4'));
  yield* fs.writeFileString(join(corrupt, 'payload'), 'corrupt');
  const rejected = yield* Effect.result(Effect.scoped(use('next-4')));
  assert.equal(rejected._tag, 'Failure');
  if (rejected._tag === 'Failure') assert.match(String(rejected.failure), /integrity mismatch/u);
  const failed = yield* Effect.result(Effect.scoped(cachedArchivePart('test', 'failure', () => Effect.fail(new Error('compiler failure')), undefined, root)));
  assert.equal(failed._tag, 'Failure');
  const cache = join(root, 'concord/parts/test');
  assert.equal((yield* fs.readDirectory(cache)).filter(name => /^[a-f0-9]{64}$/u.test(name)).length, 5, 'only four recent publications plus the held part remain');
})).pipe(Effect.provide(NodeServices.layer))));
