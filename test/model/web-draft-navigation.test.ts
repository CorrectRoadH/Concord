import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRouter, type Blocker } from 'react-router-dom';

type Blocked = Extract<Blocker, { state: 'blocked' }>;
type ReadBlockers = () => ReadonlyMap<string, Blocker>;

const shell = await Bun.file(new URL('../../web/app.tsx', import.meta.url)).text();
const discardCallback = shell.match(/void (discardAutoSave\(\)\.then\(\(\) => blocker.proceed\?\.\(\)\));/u)?.[1];
assert.ok(discardCallback);
const saveCallback = shell.match(/void (flushAutoSave\(\)\.then\(saved => \{[\s\S]*?\}\));/u)?.[1];
assert.ok(saveCallback);
const runDiscard = new Function('blocker', 'discardAutoSave', `return ${discardCallback}`);
const runSave = new Function('blocker', 'flushAutoSave', 'cancelled', 'setSaveBlocked', `return ${saveCallback}`);
const hook = await Bun.file(new URL('../../web/hooks/use-auto-save.ts', import.meta.url)).text();
const isDirty = hook.match(/isDirty: \(\) => ([^,]+),/u)?.[1];
assert.ok(isDirty);
const currentDirty = new Function('active', 'latest', 'inFlight', `return ${isDirty}`);

const completeDraftNavigation = (readBlockers: ReadBlockers, blocker: Blocked, prepare: () => Promise<boolean>, onBlocked?: () => void) => {
  void readBlockers;
  return onBlocked ? runSave(blocker, prepare, false, onBlocked) : runDiscard(blocker, prepare);
};

const requiresDraftFlush = (dirty: boolean, saving: boolean) => currentDirty({ current: true }, { current: { dirty } }, { current: saving ? Promise.resolve() : null });

function blockedNavigation(blockers: ReadBlockers, path: string): Blocked {
  const blocker = blockers().get('draft');
  assert.equal(blocker?.state, 'blocked');
  assert.equal(blocker.location.pathname, path);
  return blocker;
}

function draftRouter() {
  const router = createMemoryRouter([{ path: '*' }], { initialEntries: ['/previous', '/edit'], initialIndex: 1 });
  const readBlockers = () => router.state.blockers;
  router.getBlocker('draft', () => true);
  return { router, readBlockers };
}

// @spec docs/feature/web-workbench/architecture.md#url-与导航状态
test('a pending discard cannot open a target superseded by browser back', async t => {
  const { router, readBlockers } = draftRouter();
  t.after(() => router.dispose());
  await router.navigate('/first');
  const first = blockedNavigation(readBlockers, '/first');
  const discard = Promise.withResolvers<boolean>();
  const firstCompletion = completeDraftNavigation(readBlockers, first, () => discard.promise);

  await router.navigate(-1);
  const back = blockedNavigation(readBlockers, '/previous');
  discard.resolve(true);
  await firstCompletion;
  assert.equal(router.state.location.pathname, '/edit');
  assert.equal(blockedNavigation(readBlockers, '/previous'), back);

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
  const first = completeDraftNavigation(readBlockers, blockedNavigation(readBlockers, '/first'), () => save.promise, () => assert.fail('save succeeded'));
  await router.navigate('/second');
  const second = blockedNavigation(readBlockers, '/second');

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
  const first = blockedNavigation(readBlockers, '/first');

  const flush = Promise.withResolvers<boolean>();
  const done = completeDraftNavigation(readBlockers, first, () => flush.promise, () => assert.fail('save succeeded'));
  saving = false;
  flush.resolve(true);
  await done;
  assert.equal(router.state.location.pathname, '/first');
});
