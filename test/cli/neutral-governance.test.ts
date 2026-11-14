import { Ack, Effect, assert, call, consumer, existsSync, join, readFileSync, rmSync, test, write } from '../support/cli-fixture.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';

async function configlessConsumer(name: string): Promise<string> {
  const root = (await consumer(name));
  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'feature', { id: 'static', title: 'Static contract' }));
    (await createDocument(repo, 'issue', { id: 'static-gap', title: 'Static gap' }));
  } finally { repo.close(); }
  write(root, 'test/static.test.ts', '// @feature docs/feature/static/README.md\n// @issue docs/issues/static-gap.md\nthrow new Error("Issue closure must not load tests");\n');
  rmSync(join(root, 'concord.config.ts'));
  return root;
}

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('packed Issue closure needs no execution configuration or commits and preserves test bodies', () => Effect.runPromise(Effect.promise(async () => {
  const root = await configlessConsumer('neutral-configless-close');
  const before = readFileSync(join(root, 'test/static.test.ts'), 'utf8');
  await call(root, ['issue', 'close', 'static-gap', '--reason', 'Handled by the agent'], Ack);
  assert.equal(existsSync(join(root, 'docs/issues/static-gap.md')), false);
  assert.equal(readFileSync(join(root, 'test/static.test.ts'), 'utf8'), before.replace('// @issue docs/issues/static-gap.md\n', ''));
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
})));
