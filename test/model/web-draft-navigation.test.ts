import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRouter, type Blocker } from 'react-router-dom';
import { completeDraftNavigation, requiresDraftFlush } from '../../web/lib/draft-navigation.ts';

type Blocked = Extract<Blocker, { state: 'blocked' }>;

function blockedNavigation(router: ReturnType<typeof createMemoryRouter>, path: string): Blocked {
  const blocker = router.state.blockers.get('draft');
  assert.equal(blocker?.state, 'blocked');
  assert.equal(blocker.location.pathname, path);
  return blocker;
}

function draftRouter() {
  const router = createMemoryRouter([{ path: '*' }], { initialEntries: ['/previous', '/edit'], initialIndex: 1 });
  const readBlockers = () => router.state.blockers.values();
  router.getBlocker('draft', () => true);
  return { router, readBlockers };
}

// @spec docs/feature/web-workbench/architecture.md#url-与导航状态
test('a pending discard cannot open a target superseded by browser back', async t => {
  const { router, readBlockers } = draftRouter();
  t.after(() => router.dispose());
  await router.navigate('/first');
  const first = blockedNavigation(router, '/first');
  const discard = Promise.withResolvers<boolean>();
  const firstCompletion = completeDraftNavigation(readBlockers, first, () => discard.promise);

  await router.navigate(-1);
  const back = blockedNavigation(router, '/previous');
  discard.resolve(true);
  await firstCompletion;
  assert.equal(router.state.location.pathname, '/edit');
  assert.equal(blockedNavigation(router, '/previous'), back);

  await completeDraftNavigation(readBlockers, back, async () => true);
  await Promise.resolve();
  assert.equal(router.state.location.pathname, '/previous');
});

// @spec docs/feature/web-workbench/architecture.md#url-与导航状态
test('a write may open only the latest route even before the browser renders it', async t => {
  const { router, readBlockers } = draftRouter();
  t.after(() => router.dispose());
  await router.navigate('/first');
  const save = Promise.withResolvers<boolean>();
  const first = completeDraftNavigation(readBlockers, blockedNavigation(router, '/first'), () => save.promise, () => assert.fail('save succeeded'));
  await router.navigate('/second');
  const second = blockedNavigation(router, '/second');

  save.resolve(true);
  await first;
  assert.equal(router.state.location.pathname, '/edit');
  await completeDraftNavigation(readBlockers, second, async () => true);
  assert.equal(router.state.location.pathname, '/second');
});

// @spec docs/feature/web-workbench/architecture.md#url-与导航状态
test('undoing to the baseline still blocks navigation while a different draft is being saved', async t => {
  const { router, readBlockers } = draftRouter();
  t.after(() => router.dispose());
  let dirty = true;
  let saving = true;
  router.getBlocker('draft', () => requiresDraftFlush(dirty, saving));

  dirty = false;
  await router.navigate('/first');
  assert.equal(router.state.location.pathname, '/edit');
  const first = blockedNavigation(router, '/first');

  const flush = Promise.withResolvers<boolean>();
  const done = completeDraftNavigation(readBlockers, first, () => flush.promise, () => assert.fail('save succeeded'));
  saving = false;
  flush.resolve(true);
  await done;
  assert.equal(router.state.location.pathname, '/first');
});
