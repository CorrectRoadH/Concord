import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ContentCache, ContentCacheOwner, inheritContentCacheOwner, withContentCacheOwner, type HawdbDatabase } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { nativeArtifactRoot, hawdbTarget } from '../../src/base/installation/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/engineering/code/architecture.md#基础服务
test('entry-owned parse caches partition projects, parsers and verified installations with A→B→A reuse', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-parse-owner-'));
  const owner = new ContentCacheOwner();
  const a = makeRuntimeEnvironment(root, { ...runtime.env, XDG_CACHE_HOME: join(root, 'a') });
  const b = makeRuntimeEnvironment(root, { ...runtime.env, XDG_CACHE_HOME: join(root, 'b') });
  for (const snapshot of [a, b]) cpSync(nativeArtifactRoot(runtime), nativeArtifactRoot(snapshot), { recursive: true });
  let parses = 0;
  const read = (snapshot: typeof runtime, project = root, parser = 'parse/v1') => {
    const bound = owner.bind(snapshot, project);
    const derived = inheritContentCacheOwner(makeRuntimeEnvironment(bound.cwd, bound.env), bound);
    const cache = new ContentCache('document_parse', parser, Schema.String, undefined, derived);
    try { return cache.get('same.md', 'same source', () => { parses++; return 'parsed'; }); }
    finally { cache.close(); }
  };
  try {
    assert.equal(read(a), 'parsed');
    assert.equal(read(b), 'parsed');
    assert.equal(parses, 2, 'each verified installation has its own parse handle');
    assert.equal(read(a), 'parsed');
    assert.equal(parses, 2, 'returning to A retains its source entries');
    read(a, join(root, 'other'));
    read(a, root, 'parse/v2');
    assert.equal(parses, 4, 'project and parser identities are independent');
    const database = owner.database(a, root, 'close-probe')!;
    const manifest = join(nativeArtifactRoot(a), hawdbTarget(), 'artifact.json');
    const original = readFileSync(manifest);
    writeFileSync(`${manifest}.replacement`, '{}'); renameSync(`${manifest}.replacement`, manifest);
    read(a);
    assert.equal(parses, 5, 'invalid artifact cannot authorize a warm parse hit');
    assert.throws(() => database.scan('document_parse'), /closed/iu, 'invalid selection releases its former handles');
    writeFileSync(`${manifest}.replacement`, original); renameSync(`${manifest}.replacement`, manifest);
    read(a);
    assert.equal(parses, 6, 'repaired identity starts from a verified empty handle');
    read(b);
    assert.equal(parses, 6, 'invalidating A preserves B');
    const live = owner.database(b, root, 'close-probe')!;
    owner.close();
    assert.throws(() => live.scan('document_parse'), /closed/iu);
    read(b);
    assert.equal(parses, 7, 'a closed owner never reopens handles');
  } finally { owner.close(); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('independent entry scopes release parse handles after success, failure and cancellation', async () => {
  let parses = 0;
  const handles: HawdbDatabase[] = [];
  const read = Effect.gen(function*() {
    const bound = yield* RuntimeEnvironment;
    const cache = new ContentCache('document_parse', 'scope/v1', Schema.String, undefined, bound);
    try {
      assert.equal(cache.get('a.md', 'source', () => { parses++; return 'parsed'; }), 'parsed');
      const local = new ContentCache('document_parse', 'scope/v1', Schema.String, undefined, bound);
      try { local.get('a.md', 'source', () => { parses++; return 'parsed'; }); } finally { local.close(); }
      const engine = Reflect.get(cache, 'engine') as (this: ContentCache<string>) => HawdbDatabase;
      handles.push(engine.call(cache));
    } finally { cache.close(); }
  });
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) => withContentCacheOwner(effect).pipe(Effect.provide(RuntimeEnvironment.layer(runtime)));
  await Effect.runPromise(run(read));
  await assert.rejects(Effect.runPromise(run(read.pipe(Effect.andThen(Effect.fail('expected failure'))))));
  const controller = new AbortController();
  await assert.rejects(Effect.runPromise(run(read.pipe(Effect.andThen(Effect.sync(() => controller.abort())), Effect.andThen(Effect.never))), { signal: controller.signal }));
  assert.equal(parses, 3, 'each invocation parses once and never borrows a prior invocation');
  for (const handle of handles) assert.throws(() => handle.scan('document_parse'), /closed/iu);
});
