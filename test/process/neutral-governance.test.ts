// 跨进程保证：外部程序——中立仓库通过真实runner及Git缺陷核验完成红绿测试，核验后清理Issue且不引入宿主元数据。
import { Ack, AnnotationOutput, Schema, Effect, assert, call, callString, consumer, existsSync, join, readFileSync, test, write, writeProjectConfig } from '../support/cli-fixture.ts';
import { gitCommit, gitCommand } from '../support/fix-consumer.ts';

const Cases = Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String, file: Schema.String })) });
const Verification = Schema.Struct({ verification: Schema.Struct({ defect: Schema.String, fix: Schema.String }) });

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('a neutral software consumer completes Spec, source relations, configured execution, fix verification and review through the packed CLI', () => Effect.runPromise(Effect.promise(async () => {
  const root = (await consumer('neutral-governance'));
  const contract = 'docs/feature/cart/use-case/add-item.md';
  (await call(root, ['new', 'feature', 'cart', '--title', 'Cart'], Ack));
  (await call(root, ['new', 'use-case', 'add-item', '--feature', 'cart', '--title', 'Add item'], Ack));
  (await call(root, ['new', 'issue', 'quantity', '--title', 'Accumulate quantity'], Ack));
  writeProjectConfig(root, { testRoots: ['spec'], sourceRoots: ['lib'], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 5000 } });
  write(root, 'lib/cart.ts', `// @concord-file\n// @concord-implements ${contract}\nexport const quantity = 1;\n`);
  gitCommit(root, 'neutral consumer implementation and Spec');
  const annotation = (await call(root, ['test', 'marker', '--contract', contract, '--issue', 'docs/issues/quantity.md'], AnnotationOutput));
  write(root, 'spec/cart.test.ts', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../lib/cart.ts';\n${annotation.snippet}test('quantity accumulates', () => assert.equal(quantity, 2));\n`);
  const defect = gitCommit(root, 'failing quantity regression');
  const cases = (await call(root, ['test', 'list'], Cases)).cases;
  assert.equal(cases.length, 1);
  assert.equal(cases[0]?.file, 'spec/cart.test.ts');
  const id = cases[0]!.id;
  const trace = (await call(root, ['trace', 'show', 'cart'], Schema.Struct({
    tests: Schema.Array(Schema.Struct({ id: Schema.String })),
    codeDeclarations: Schema.Array(Schema.Struct({ file: Schema.String })),
  })));
  assert.deepEqual(trace.tests.map(item => item.id), [id]);
  assert.deepEqual(trace.codeDeclarations.map(item => item.file), ['lib/cart.ts']);
  const outcome = Schema.Struct({ scope: Schema.String, commandOutcome: Schema.String, execution: Schema.String, exitCode: Schema.Number });
  assert.deepEqual((await call(root, ['test', 'run', id], outcome, '', 1)), { scope: 'command', commandOutcome: 'fail', execution: 'ran', exitCode: 1 });
  write(root, 'lib/cart.ts', readFileSync(join(root, 'lib/cart.ts'), 'utf8').replace('quantity = 1', 'quantity = 2'));
  const fix = gitCommit(root, 'accumulate quantity');
  assert.deepEqual((await call(root, ['test', 'run', id], outcome)), { scope: 'command', commandOutcome: 'pass', execution: 'ran', exitCode: 0 });
  const closed = (await call(root, ['issue', 'close', 'quantity', '--fixed', '--reason', 'Accumulate quantity', '--defect', defect], Verification));
  assert.deepEqual(closed.verification, { defect, fix });
  const checked = (await call(root, ['check'], Schema.Struct({ ok: Schema.Boolean })));
  assert.equal(checked.ok, true);
  assert.equal('verifications' in checked, false);
  const review = (await callString(root, ['review', 'cart']));
  assert.ok(review.includes(id));
  assert.ok(!review.includes('docs/issues/quantity.md'));
  assert.equal(existsSync(join(root, 'docs/issues/quantity.md')), false);
  assert.ok(!readFileSync(join(root, 'spec/cart.test.ts'), 'utf8').includes('@issue'));
  assert.equal(existsSync(join(root, 'nx.json')), false);
  assert.equal(existsSync(join(root, 'package.json')), false, 'consumer needs no product package or host metadata');
  assert.equal(gitCommand(root, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
})));
