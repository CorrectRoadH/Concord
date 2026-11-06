import { assert, existsSync, readFileSync, join, test, Effect, run, consumer, action } from './onboarding-independent-fixture.ts';


// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('installed config.set creates optional configuration and rejects retired fields and stale digests', () => Effect.runPromise(Effect.promise(async () => {
  const root = consumer('config');
  await run(root, ['init']);
  const current = await run(root, ['config', 'show']);
  assert.deepEqual(current.config, {});
  await action(root, { action: 'config.set', config: { testRoots: [] }, expectedDigest: current.digest });
  const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
  assert.doesNotMatch(source, /projectId|concord.project|memorySources/u);
  assert.equal((await action(root, { action: 'config.set', config: {}, expectedDigest: current.digest }, 1)).error, 'FileChangedSinceRead');
  const next = await run(root, ['config', 'show']);
  assert.equal((await action(root, { action: 'config.set', config: { projectId: 'legacy' }, expectedDigest: next.digest }, 1)).error, 'InvalidData');
  assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
})));


// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('installed new and relation helpers persist only current owner fields', () => Effect.runPromise(Effect.promise(async () => {
  const root = consumer('owners');
  await run(root, ['init']);
  await run(root, ['new', 'feature', 'cart']);
  await run(root, ['new', 'use-case', 'add', '--feature', 'cart']);
  await run(root, ['new', 'memory', 'choice']);
  await run(root, ['memory', 'link', 'choice', 'docs/feature/cart/README.md']);
  await run(root, ['new', 'issue', 'bug']);
  await run(root, ['issue', 'link', 'bug', 'memory/choice.md', '--role', 'investigation']);
  await run(root, ['issue', 'unlink', 'bug', 'memory/choice.md', '--role', 'investigation']);
  await run(root, ['issue', 'link', 'bug', 'docs/feature/cart/README.md', '--role', 'spec']);
  await run(root, ['issue', 'unlink', 'bug', 'docs/feature/cart/README.md', '--role', 'spec']);
  assert.match(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /role: supports/u);
  assert.doesNotMatch(readFileSync(join(root, 'docs/issues/bug.md'), 'utf8'), /relations:|history:|format:|draft/u);
  assert.equal((await run(root, ['list', 'issue'])).documents.length, 1);
})));


// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('installed new Design creates one directly editable tradeoff page', () => Effect.runPromise(Effect.promise(async () => {
  const root = consumer('design');
  await run(root, ['init']);
  await run(root, ['new', 'design', 'storage']);
  assert.equal(existsSync(join(root, 'docs/design/storage.md')), true);
  assert.equal(existsSync(join(root, 'docs/design/storage')), false);
})));
