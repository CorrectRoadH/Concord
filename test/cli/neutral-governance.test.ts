import { ErrorOutput, Effect, assert, call, consumer, join, readFileSync, rmSync, test, write } from '../support/cli-fixture.ts';
import { gitCommit } from '../support/fix-consumer.ts';
import { createDocument } from '../support/operations.ts';
import { buildTrace } from '../../src/app/index.ts';
import { LocalRepository } from '../support/repository.ts';

async function configlessConsumer(name: string): Promise<string> {
  const root = (await consumer(name));
  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'feature', { id: 'static', title: 'Static contract' }));
    (await createDocument(repo, 'issue', { id: 'missing-runner', title: 'Missing runner' }));
  } finally { repo.close(); }
  write(root, 'test/static.test.ts', '// @feature docs/feature/static/README.md\n// @issue docs/issues/missing-runner.md\n');
  rmSync(join(root, 'concord.config.ts'));
  return root;
}

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('packed execution and fixed closure require a runner while preserving the open Issue', () => Effect.runPromise(Effect.promise(async () => {
  const root = (await configlessConsumer('neutral-configless-runner'));
  gitCommit(root, 'configless neutral consumer');
  const repo = (await LocalRepository.open(root, { access: 'read' }));
  let id: string;
  try { id = (await buildTrace(repo, 'off', { includeCode: false })).annotations.cases[0]!.id; } finally { repo.close(); }
  assert.equal((await call(root, ['test', 'run', id], ErrorOutput, '', 1)).error, 'FixUnverifiable');
  assert.equal((await call(root, ['issue', 'close', 'missing-runner', '--fixed', '--reason', 'No runner'], ErrorOutput, '', 1)).error, 'FixUnverifiable');
  const issue = readFileSync(join(root, 'docs/issues/missing-runner.md'), 'utf8');
  assert.doesNotMatch(issue, /status:|closure:/u);
  assert.doesNotMatch(issue, /verification:/u);
})));
