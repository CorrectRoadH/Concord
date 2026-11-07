import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gateAdmissionBytes, gateConcurrency, gateMemoryBudgets, gateMemoryMax, GiB } from '../../scripts/gate-resources.ts';

// @feature docs/engineering/testing/cli.md#并发
test('gate defaults converge on CPU and memory budgets, using the full admission pool', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(gateMemoryMax(31 * GiB, {}), 15 * GiB);
  assert.equal(gateMemoryMax(31.9 * GiB, {}), 15 * GiB);
  for (const [memory, cpu, node] of [[15, 16, 8], [8, 16, 8], [4, 16, 8], [64, 32, 8], [15, 2, 1], [1, 1, 1]]) {
    const result = gateConcurrency(memory! * GiB, cpu!, {});
    assert.deepEqual([result.node], [node], `memory=${memory}, CPU=${cpu}`);
    assert.equal(result.availableNodeMemoryBytes, Math.max(0, (memory! - 2) * GiB));
  }
  assert.equal(gateConcurrency(8 * GiB, 16, { CONCORD_TEST_CONCURRENCY: '12' }).node, 12);
  for (const name of ['CONCORD_TEST_CONCURRENCY']) {
    for (const value of ['0', '-1', '1.5', '2x', '', '1e2', '+2', '9007199254740992']) {
      assert.throws(() => gateConcurrency(15 * GiB, 16, { [name]: value }), { _tag: 'GateResourcesInvalid' }, `${name}=${value}`);
    }
  }
})));

// @feature docs/engineering/testing/README.md#共享资源与同步
test('dedicated GitHub CI reserves one GiB while development keeps the half-memory cap', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(gateMemoryMax(8 * GiB, { GITHUB_ACTIONS: 'true' }), 7 * GiB);
  assert.equal(gateMemoryMax(8 * GiB - 256 * 1024 ** 2, { GITHUB_ACTIONS: 'true' }), 7 * GiB - 256 * 1024 ** 2);
  assert.equal(gateAdmissionBytes(gateMemoryMax(8 * GiB, { GITHUB_ACTIONS: 'true' })), 5 * GiB);
  for (const env of [{}, { CI: 'true' }, { GITHUB_ACTIONS: 'false' }]) assert.equal(gateMemoryMax(8 * GiB, env), 4 * GiB);
  assert.equal(gateMemoryMax(GiB, { GITHUB_ACTIONS: 'true' }), 1);
})));

// @feature docs/engineering/testing/cli.md#并发
test('admission subtracts fixed overhead without raising the cap', () => Effect.runPromise(Effect.sync(() => {
  assert.deepEqual(gateMemoryBudgets, { fixed: 2 * GiB, node: 2 * GiB });
  assert.equal(gateAdmissionBytes(7 * GiB), 5 * GiB);
  assert.equal(gateAdmissionBytes(GiB / 2), 0);
})));
