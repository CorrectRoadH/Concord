import { assert, test, run, consumer, action } from './onboarding-independent-fixture.ts';
import { initialize, createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/feature/local-sdlc/README.md
test('owner and configuration commands map arguments to publication receipts and named errors', async () => {
  const root = consumer('owner-mapping');
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo);
    createDocument(repo, 'feature', { id: 'cart', title: 'Cart' });
  } finally { repo.close(); }
  const current = await run(root, ['config', 'show']);
  assert.deepEqual(current.config, {});
  const configured = await action(root, { action: 'config.set', config: { testRoots: [] }, expectedDigest: current.digest });
  assert.deepEqual(configured.changedPaths, ['concord.config.ts']);
  assert.equal((await action(root, { action: 'config.set', config: {}, expectedDigest: current.digest }, 1)).error, 'FileChangedSinceRead');
  for (const [kind, id, path] of [['memory', 'choice', 'memory/choice.md'], ['issue', 'bug', 'docs/issues/bug.md'], ['design', 'storage', 'docs/design/storage.md']] as const) {
    const created = await run(root, ['new', kind, id]);
    assert.equal(created.operation, 'new');
    assert.deepEqual(created.changedPaths, [path]);
  }
  const supported = await run(root, ['memory', 'link', 'choice', 'docs/feature/cart/README.md']);
  assert.deepEqual(supported.changedPaths, ['memory/choice.md']);
  for (const [target, role] of [['memory/choice.md', 'investigation'], ['docs/feature/cart/README.md', 'spec']] as const) {
    for (const command of ['link', 'unlink']) {
      const result = await run(root, ['issue', command, 'bug', target, '--role', role]);
      assert.deepEqual(result.changedPaths, ['docs/issues/bug.md']);
    }
  }
});
