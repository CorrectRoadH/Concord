// 跨进程保证：运行环境——真实 Bun 发布入口校验锁与工具版本后才写入发布版本，失败以非零退出且保留原文件。
// @concord-file
// @concord-implements docs/engineering/build/architecture.md#依赖安装
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

const checkout = join(import.meta.dirname, '../..');
const ObjectValue = Schema.Record(Schema.String, Schema.Unknown);
const run = Effect.fn('test.releasePreparation')(function*(root: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make('bun', ['--no-env-file', '--config=/dev/null', join(checkout, 'scripts/prepare-release.ts')], {
    cwd: root, env: { ...process.env, RELEASE_TAG: 'concord-v1.2.3' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [code, stdout, stderr] = yield* Effect.all([child.exitCode, Stream.mkString(Stream.decodeText(child.stdout)), Stream.mkString(Stream.decodeText(child.stderr))], { concurrency: 'unbounded' });
  return { code: Number(code), text: stdout + stderr };
}, Effect.scoped, Effect.timeout('20 seconds'));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
test('release preparation consumes the actual frozen Bun lock and preserves it when applying a tag', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-inputs-' });
  for (const name of ['package.json', 'bun.lock', '.bun-version']) yield* fs.copyFile(join(checkout, name), join(root, name));
  const locked = yield* fs.readFileString(join(root, 'bun.lock'));
  const result = yield* run(root);
  assert.equal(result.code, 0, result.text);
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ObjectValue))(yield* fs.readFileString(join(root, 'package.json')));
  assert.equal(manifest.version, '1.2.3');
  assert.equal(yield* fs.readFileString(join(root, 'bun.lock')), locked);
})).pipe(Effect.provide(NodeServices.layer))));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
test('release preparation refuses manifest, lock policy and runtime mismatches before writing a version', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-rejected-' });
  const original = yield* fs.readFileString(join(checkout, 'package.json'));
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ObjectValue))(original);
  const locked = yield* fs.readFileString(join(checkout, 'bun.lock'));
  const version = yield* fs.readFileString(join(checkout, '.bun-version'));
  const changes: readonly [string, unknown][] = [
    ['dependencies', {}], ['devDependencies', {}], ['overrides', {}], ['patchedDependencies', {}],
    ['trustedDependencies', []], ['packageManager', 'bun@0.0.0'],
  ];
  for (const [key, value] of changes) {
    const changed = JSON.stringify({ ...manifest, [key]: value });
    yield* fs.writeFileString(join(root, 'package.json'), changed);
    yield* fs.writeFileString(join(root, 'bun.lock'), locked);
    yield* fs.writeFileString(join(root, '.bun-version'), version);
    const result = yield* run(root);
    assert.notEqual(result.code, 0, key);
    assert.match(result.text, /ReleasePreparationError/u, key);
    assert.equal(yield* fs.readFileString(join(root, 'package.json')), changed, key);
  }
  yield* fs.writeFileString(join(root, 'package.json'), original);
  for (const invalid of ['{', locked.replace('"lockfileVersion": 2', '"lockfileVersion": 999'), locked.replace('"configVersion": 1', '"configVersion": 1, "unknown": true')]) {
    yield* fs.writeFileString(join(root, 'bun.lock'), invalid);
    const result = yield* run(root);
    assert.notEqual(result.code, 0);
    assert.match(result.text, /ReleasePreparationError/u);
    assert.equal(yield* fs.readFileString(join(root, 'package.json')), original);
  }
})).pipe(Effect.provide(NodeServices.layer))));
