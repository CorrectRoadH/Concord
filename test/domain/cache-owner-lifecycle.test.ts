import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makePersistentCacheOwner, PersistentCache } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-data-engine/architecture.md#状态
// @issue docs/issues/native-open-blocks-service.md
test('persistent owner opening and closing allow the service event loop to run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-owner-lifecycle-'));
  const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* makePersistentCacheOwner(directory);
      let openingTurn = false;
      const openingTimer = setTimeout(() => { openingTurn = true; }, 0);
      try {
        yield* owner.open;
        assert.equal(openingTurn, true, 'cold persistent open must yield the JS event loop');
      } finally { clearTimeout(openingTimer); }
      let closingTurn = false;
      const closingTimer = setTimeout(() => { closingTurn = true; }, 0);
      try {
        yield* owner.close;
        assert.equal(closingTurn, true, 'persistent close must yield the JS event loop');
      } finally { clearTimeout(closingTimer); }
    })).pipe(Effect.provide(PersistentCache.layer), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
