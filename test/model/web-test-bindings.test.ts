import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NativeBindingView } from '../../src/model/index.ts';
import { TestBindings } from '../../web/components/test-bindings.ts';

// @use-case docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#inspect-native
test('the workbench renders the supplied native binding and collection limits', () => {
  const binding: NativeBindingView = {
    testId: 'marker', current: true, complete: false, gaps: ['adapter omits parameter groups'],
    nativeCases: [{ nativeId: 'bun:cart.add/discount', project: 'cart', file: 'test/cart.test.ts', kind: 'leaf', group: 'discounts', range: { startLine: 12, endLine: 18, sourceDigest: 'digest-from-collection' }, tags: { priority: 'p0', layer: 'domain' } }],
  };
  const html = renderToStaticMarkup(createElement(TestBindings, { binding }));
  for (const value of ['bun:cart.add/discount', 'cart', 'test/cart.test.ts', 'leaf', 'discounts', '12', '18', 'digest-from-collection', 'priority', 'p0', 'layer', 'domain', '当前', '不完整', 'adapter omits parameter groups', '收集与绑定不表示测试通过或覆盖。']) assert.ok(html.includes(value), value);
  assert.equal(html.includes('<button'), false, 'observations expose no execution controls');
});

// @use-case docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#inspect-native
test('missing or stale binding observations remain explicit and never infer native identities', () => {
  const unknown = renderToStaticMarkup(createElement(TestBindings, { binding: undefined }));
  assert.ok(unknown.includes('具体用例观察未知'));
  const stale = renderToStaticMarkup(createElement(TestBindings, { binding: { testId: 'cart', current: false, complete: false, nativeCases: [], gaps: ['observation is stale'] } }));
  assert.ok(stale.includes('未知或过期'));
  assert.ok(stale.includes('observation is stale'));
  assert.ok(stale.includes('没有已绑定的具体用例'));
  assert.equal(stale.includes('原生身份'), false);
});
