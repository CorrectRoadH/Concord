import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { affectedTestContract, gateSelectionArguments, isFullGateSelection } from '../../scripts/gate-selection.ts';

// @feature docs/engineering/testing/cli.md#完整门禁
test('changed gate matches package ownership and Use Case boundaries without anchor or prefix leakage', () => Effect.runPromise(Effect.sync(() => {
  const root = 'docs/feature/alpha/README.md', a = 'docs/feature/alpha/use-case/a.md';
  assert.equal(affectedTestContract(`${a}#changed`, `${a}#other`), true);
  assert.equal(affectedTestContract(a, root), true);
  assert.equal(affectedTestContract(a, 'docs/feature/alpha/use-case/b.md'), false);
  assert.equal(affectedTestContract(a, 'docs/feature/alpha/cli.md'), false);
  assert.equal(affectedTestContract('docs/feature/alpha/cli.md', 'docs/feature/alpha/use-case/b.md'), true);
  assert.equal(affectedTestContract(root, 'docs/feature/alphabet/README.md'), false);
  assert.equal(affectedTestContract('docs/taste.md', root), false);
  assert.equal(affectedTestContract('docs/engineering/testing/architecture.md', 'docs/engineering/testing/use-case/run.md'), true);
  assert.deepEqual(gateSelectionArguments(['--changed', 'HEAD~1', '--test-name-pattern', 'with spaces', 'test/model/a.test.ts']), {
    changed: 'HEAD~1', positionals: ['test/model/a.test.ts'], args: ['--test-name-pattern', 'with spaces'],
  });
  assert.equal(gateSelectionArguments(['--changed', 'test/model/a.test.ts']).changed, '');
  assert.equal(gateSelectionArguments(['--changed=HEAD']).changed, 'HEAD');
  assert.throws(() => gateSelectionArguments(['--changed', '--changed=HEAD']), { _tag: 'GateSelectionInvalid' });
})));

// @feature docs/engineering/testing/README.md#共享资源与同步
test('only a complete unfiltered gate selection enters the full-gate queue', () => {
  const allFiles = ['a.test.ts', 'b.e2e.ts'];
  assert.equal(isFullGateSelection({ files: allFiles, allFiles, args: [] }), true);
  assert.equal(isFullGateSelection({ files: ['a.test.ts'], allFiles, args: [] }), false);
  assert.equal(isFullGateSelection({ files: [], allFiles, args: [] }), false);
  for (const args of [['--test-name-pattern=selected'], ['--test-name-pattern', 'selected'], ['--test-shard=1/16'], ['--suite', 'node']]) {
    assert.equal(isFullGateSelection({ files: allFiles, allFiles, args }), false, args.join(' '));
  }
});
