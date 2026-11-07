import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gateAdmittedBrowserWorkers, gateAdmissionBytes, gateConcurrency, gateMemoryBudgets, gateMemoryMax, GiB } from '../../scripts/gate-resources.ts';

// @feature docs/engineering/testing/cli.md#并发
test('gate defaults converge on CPU and memory budgets, reserving browser memory first', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(gateMemoryMax(31 * GiB, {}), 15 * GiB);
  assert.equal(gateMemoryMax(31.9 * GiB, {}), 15 * GiB);
  for (const [memory, cpu, node, browser] of [[15, 16, 8, 3], [8, 16, 8, 1], [4, 16, 8, 1], [64, 32, 8, 4], [15, 2, 1, 1], [1, 1, 1, 1]]) {
    const result = gateConcurrency(memory! * GiB, cpu!, {});
    assert.deepEqual([result.node, result.browser], [node, browser], `memory=${memory}, CPU=${cpu}`);
    assert.equal(result.availableNodeMemoryBytes, Math.max(0, (memory! - 2) * GiB - browser! * 2.5 * GiB));
  }
  assert.deepEqual(gateConcurrency(15 * GiB, 16, { CONCORD_E2E_WORKERS: '4' }), { node: 8, browser: 4, availableNodeMemoryBytes: 3 * GiB });
  assert.deepEqual(gateConcurrency(8 * GiB, 16, { CONCORD_TEST_CONCURRENCY: '12', CONCORD_E2E_WORKERS: '7' }), { node: 12, browser: 7, availableNodeMemoryBytes: 0 });
  for (const name of ['CONCORD_TEST_CONCURRENCY', 'CONCORD_E2E_WORKERS']) {
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
test('admission subtracts fixed overhead and clips browser overrides without raising the cap', () => Effect.runPromise(Effect.sync(() => {
  assert.deepEqual(gateMemoryBudgets, { fixed: 2 * GiB, archive: 2.5 * GiB, browser: 2.5 * GiB, packaging: 3 * GiB, node: 2 * GiB });
  assert.equal(gateAdmissionBytes(7 * GiB), 5 * GiB);
  assert.equal(gateAdmittedBrowserWorkers(7 * GiB, 4), 2);
  assert.equal(gateAdmittedBrowserWorkers(15 * GiB, 4), 4);
  assert.equal(gateAdmittedBrowserWorkers(2 * GiB, 4), 0);
  assert.equal(gateAdmissionBytes(GiB / 2), 0);
})));
