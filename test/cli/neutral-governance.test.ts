import {
  CheckOutput, ErrorOutput, Schema, Effect, assert, call, consumer, join, readFileSync, rmSync, test, write,
} from '../support/cli-fixture.ts';
import { gitCommit } from '../support/fix-consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';

const Cases = Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) });
function configlessConsumer(name: string): string {
  const root = consumer(name);
  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'feature', { id: 'static', title: 'Static contract' });
    createDocument(repo, 'issue', { id: 'missing-runner', title: 'Missing runner' });
  } finally { repo.close(); }
  write(root, 'test/static.test.ts', '// @feature docs/feature/static/README.md\n// @issue docs/issues/missing-runner.md\n');
  rmSync(join(root, 'concord.config.ts'));
  return root;
}

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('a configless neutral consumer supports static checks and trace through the packed CLI', () => Effect.runPromise(Effect.sync(() => {
  const root = configlessConsumer('neutral-configless-static');
  const cases = call(root, ['test', 'list'], Cases).cases;
  assert.equal(cases.length, 1);
  assert.deepEqual(call(root, ['trace', 'show', 'static'], Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) })).tests.map(item => item.id), [cases[0]!.id]);
  assert.equal(call(root, ['check'], CheckOutput).ok, true);
})));

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('packed execution and fixed closure require a runner while preserving the open Issue', () => Effect.runPromise(Effect.sync(() => {
  const root = configlessConsumer('neutral-configless-runner');
  gitCommit(root, 'configless neutral consumer');
  const id = call(root, ['test', 'list'], Cases).cases[0]!.id;
  assert.equal(call(root, ['test', 'run', id], ErrorOutput, '', 1).error, 'FixUnverifiable');
  assert.equal(call(root, ['issue', 'close', 'missing-runner', '--fixed', '--reason', 'No runner'], ErrorOutput, '', 1).error, 'FixUnverifiable');
  const issue = readFileSync(join(root, 'docs/issues/missing-runner.md'), 'utf8');
  assert.doesNotMatch(issue, /status:|closure:/u);
  assert.doesNotMatch(issue, /verification:/u);
})));
