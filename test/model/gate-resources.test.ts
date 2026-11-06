import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gateConcurrency, gateMemoryMax, GiB } from '../../scripts/gate-resources.js';

// @feature docs/engineering/testing/cli.md#并发
test('gate defaults converge on CPU and memory budgets, reserving browser memory first', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(gateMemoryMax(31 * GiB), 15 * GiB);
  assert.equal(gateMemoryMax(31.9 * GiB), 15 * GiB);
  for (const [memory, cpu, node, browser] of [[15, 16, 8, 1], [8, 16, 5, 1], [4, 16, 1, 1], [64, 32, 8, 4], [15, 2, 1, 1], [1, 1, 1, 1]]) {
    const result = gateConcurrency(memory! * GiB, cpu!, {});
    assert.deepEqual([result.node, result.browser], [node, browser], `memory=${memory}, CPU=${cpu}`);
    assert.equal(result.availableNodeMemoryBytes, Math.max(0, memory! * GiB - browser! * 2.5 * GiB));
  }
  assert.deepEqual(gateConcurrency(15 * GiB, 16, { CONCORD_E2E_WORKERS: '4' }), { node: 5, browser: 4, availableNodeMemoryBytes: 5 * GiB });
  assert.deepEqual(gateConcurrency(8 * GiB, 16, { CONCORD_TEST_CONCURRENCY: '12', CONCORD_E2E_WORKERS: '7' }), { node: 12, browser: 7, availableNodeMemoryBytes: 0 });
  for (const name of ['CONCORD_TEST_CONCURRENCY', 'CONCORD_E2E_WORKERS']) {
    for (const value of ['0', '-1', '1.5', '2x', '', '1e2', '+2', '9007199254740992']) {
      assert.throws(() => gateConcurrency(15 * GiB, 16, { [name]: value }), { _tag: 'GateResourcesInvalid' }, `${name}=${value}`);
    }
  }
})));
