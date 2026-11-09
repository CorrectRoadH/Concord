import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gateConcurrency } from '../../scripts/gate-resources.ts';

// @feature docs/engineering/testing/cli.md#并发
test('gate concurrency follows CPU availability and explicit overrides', () => Effect.runPromise(Effect.sync(() => {
  for (const [cpu, node] of [[16, 8], [32, 8], [2, 1], [1, 1], [7, 3]]) {
    assert.deepEqual(gateConcurrency(cpu!, {}), { node });
  }
  assert.equal(gateConcurrency(16, { CONCORD_TEST_CONCURRENCY: '12' }).node, 12);
  for (const value of ['0', '-1', '1.5', '2x', '', '1e2', '+2', '9007199254740992']) {
    assert.throws(() => gateConcurrency(16, { CONCORD_TEST_CONCURRENCY: value }), { _tag: 'GateResourcesInvalid' });
  }
})));
