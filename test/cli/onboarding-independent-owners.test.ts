import { sourceCli, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, tmpdir, stopWorkspaceServer, join, test, before, after, Effect, Schema, InitializationReceiptSchema, scratch, consumers, cli, run, consumer, action } from './onboarding-independent-fixture.ts';


// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('installed config.set creates optional configuration and rejects retired fields and stale digests', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('config');
  run(root, ['init']);
  const current = run(root, ['config', 'show']);
  assert.deepEqual(current.config, {});
  action(root, { action: 'config.set', config: { testRoots: [] }, expectedDigest: current.digest });
  const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
  assert.doesNotMatch(source, /projectId|concord.project|memorySources/u);
  assert.equal(action(root, { action: 'config.set', config: {}, expectedDigest: current.digest }, 1).error, 'FileChangedSinceRead');
  const next = run(root, ['config', 'show']);
  assert.equal(action(root, { action: 'config.set', config: { projectId: 'legacy' }, expectedDigest: next.digest }, 1).error, 'InvalidData');
  assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
})));


// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('installed new and relation helpers persist only current owner fields', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('owners');
  run(root, ['init']);
  run(root, ['new', 'feature', 'cart']);
  run(root, ['new', 'use-case', 'add', '--feature', 'cart']);
  run(root, ['new', 'memory', 'choice']);
  run(root, ['memory', 'link', 'choice', 'docs/feature/cart/README.md']);
  run(root, ['new', 'issue', 'bug']);
  run(root, ['issue', 'link', 'bug', 'memory/choice.md', '--role', 'investigation']);
  run(root, ['issue', 'unlink', 'bug', 'memory/choice.md', '--role', 'investigation']);
  run(root, ['issue', 'link', 'bug', 'docs/feature/cart/README.md', '--role', 'adopts']);
  run(root, ['issue', 'unlink', 'bug', 'docs/feature/cart/README.md', '--role', 'adopts']);
  assert.match(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /role: supports/u);
  assert.doesNotMatch(readFileSync(join(root, 'docs/issues/bug.md'), 'utf8'), /relations:|history:|format:|draft/u);
  assert.equal(run(root, ['list', 'issue']).documents.length, 1);
})));


// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('installed new Design creates one directly editable tradeoff page', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('design');
  run(root, ['init']);
  run(root, ['new', 'design', 'storage']);
  assert.equal(existsSync(join(root, 'docs/design/storage.md')), true);
  assert.equal(existsSync(join(root, 'docs/design/storage')), false);
})));
