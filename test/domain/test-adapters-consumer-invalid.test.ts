import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { adapterConsumer, adapterQuery, adapterSuccess, clearAdapterCache, corruptObservation, discoverAdapter } from '../support/adapter-cache-domain.ts';
import { runApplication } from '../support/repository.ts';
import { text } from '../support/test-adapters-consumer-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name external-adapter-invalid-source-cache
test('external adapter preserves invalid-source findings across cold warm corrupt and cleared caches', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => runApplication(Effect.scoped(Effect.gen(function* () {
  const consumer = yield* adapterConsumer;
  // Recreate the valid cached source that precedes the invalid-source phase.
  yield* clearAdapterCache(consumer);
  yield* adapterSuccess(consumer, 'check');
  yield* adapterSuccess(consumer, 'test.list');
  const markedSource = readFileSync(join(consumer, 'test/sample.ts'), 'utf8');
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource.replace('docs/feature/example/README.md', 'docs/feature/missing/README.md')));
  let wrongSource: unknown;
  for (const state of ['cold', 'warm', 'corrupt', 'clear']) {
    if (state === 'warm') yield* discoverAdapter(consumer);
    if (state === 'corrupt') yield* corruptObservation(consumer);
    if (state === 'clear') yield* clearAdapterCache(consumer);
    const checked = yield* adapterQuery(consumer, 'check'); assert.equal(checked.exitCode, 1);
    const result = checked.value; const stable = { ok: result.ok, complete: result.complete, findings: result.findings };
    if (wrongSource === undefined) wrongSource = stable; else assert.deepEqual(stable, wrongSource, state);
    assert.ok(Array.isArray(result.findings) && result.findings.length > 0);
  }
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource));
  yield* discoverAdapter(consumer);
}))));
