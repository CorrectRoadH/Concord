// 跨进程保证：运行环境——新进程重建自己的有界文档内存缓存，重复批次共享解析且不留下持久文档库。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { Installation } from '../../src/base/installation/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { makeComputationOwner } from '../../src/entry/server/main.ts';
import { fixture, useCasePath } from '../support/document-cache-fixture.ts';

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('metadata stays lazy and one tree serves repeated and duplicate requests without persistent document state', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await fixture()), counts = join(root, 'parse-counts.jsonl');
  const probe = (mode?: 'off' | 'metadata') => {
    const child = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('../support/parse-count-probe.ts', import.meta.url)), fileURLToPath(new URL('../support/parse-cache-source-probe.ts', import.meta.url)), root, ...(mode === undefined ? [] : [mode])], {
      encoding: 'utf8', timeout: 60_000, env: { ...process.env, CONCORD_TEST_PARSE_COUNTS: counts },
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    return child.stdout;
  };
  const calls = () => existsSync(counts) ? readFileSync(counts, 'utf8').trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.String)(JSON.parse(line))) : [];
  try {
    probe('metadata');
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1, 'title derivation parses the current owner once');
    rmSync(counts);
    const first = probe();
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1, 'duplicate batch inputs and repeated steps/anchors share one parse');
    const firstCalls = calls().length;
    assert.ok(firstCalls > 0);
    rmSync(counts);
    assert.equal(probe(), first);
    assert.equal(calls().length, firstCalls, 'a fresh process reconstructs its own bounded memory cache');
    rmSync(counts);
    assert.equal(probe('off'), first);
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1);
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false, 'document parsing never creates a persistent database');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @feature docs/engineering/code/architecture.md#基础服务
// @issue docs/issues/test-architecture-gaps.md
test('one real compute retains parsed source between requests and rebuilds after source changes', async () => {
  const root = (await fixture()), counts = join(root, 'parse-counts.jsonl');
  const preload = fileURLToPath(new URL('../support/parse-count-probe.ts', import.meta.url));
  const environment = Object.fromEntries(Object.entries({ ...process.env,
    BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ''} --preload=${preload}`.trim(), CONCORD_TEST_PARSE_COUNTS: counts,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const runtime = makeRuntimeEnvironment(root, environment);
  const calls = () => readFileSync(counts, 'utf8').trim().split('\n')
    .map(line => Schema.decodeUnknownSync(Schema.String)(JSON.parse(line)))
    .filter(source => source.includes('parser-sentinel')).length;
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* makeComputationOwner(root);
      const read = () => owner.run({ kind: 'query', request: { name: 'documents.list', input: {} }, cwd: root, environment });
      const first = yield* read();
      assert.equal(calls(), 1, 'the real parser observes the original source once');
      assert.deepEqual(yield* read(), first);
      assert.equal(calls(), 1, 'an unchanged request reuses the compute-owned parse cache');
      const path = join(root, useCasePath);
      writeFileSync(path, readFileSync(path, 'utf8').replace('parser-sentinel source', 'parser-sentinel changed source'));
      assert.deepEqual(yield* read(), first, 'body changes keep the listed metadata');
      assert.equal(calls(), 2, 'changed source is parsed before accepting its current metadata');
    })).pipe(Effect.provide(Installation.layer), Effect.provide(NodeServices.layer), Effect.provide(RuntimeEnvironment.layer(runtime))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
