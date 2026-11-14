// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#inspect-native
import { createElement, type ReactNode } from 'react';
import type { NativeBindingView } from '../../src/model/index.ts';

function definition(label: string, value: ReactNode) {
  return createElement('div', { className: 'definition', key: label }, createElement('dt', null, label), createElement('dd', null, value));
}

export function TestBindings({ binding }: { binding: NativeBindingView | undefined }) {
  if (!binding) return createElement('p', { className: 'muted' }, '具体用例观察未知，尚无绑定投影。');
  const nativeCases = binding.nativeCases.map(nativeCase => {
    const labels = Object.entries(nativeCase.tags).map(([name, value]) => createElement('span', { className: 'block', key: name }, createElement('code', null, name), '：', value));
    return createElement('li', { key: `${nativeCase.project}:${nativeCase.nativeId}` }, createElement('dl', null,
      definition('原生身份', createElement('code', null, nativeCase.nativeId)),
      definition('项目', nativeCase.project),
      definition('来源', createElement('code', null, nativeCase.file)),
      definition('类型', nativeCase.kind),
      nativeCase.group !== undefined && definition('分组', nativeCase.group),
      nativeCase.range && definition('范围', `第 ${nativeCase.range.startLine}–${nativeCase.range.endLine} 行`),
      nativeCase.range && definition('源码摘要', createElement('code', null, nativeCase.range.sourceDigest)),
      definition('Labels', labels.length === 0 ? '无' : labels)));
  });
  return createElement('section', { 'aria-label': '具体用例绑定' },
    createElement('dl', null,
      definition('观察', binding.current ? '当前' : '未知或过期'),
      definition('收集与绑定', binding.complete ? '完整' : '不完整')),
    createElement('p', { className: 'muted' }, '收集与绑定不表示测试通过或覆盖。'),
    binding.gaps.length > 0 && createElement('div', null,
      createElement('strong', null, '能力缺口'),
      createElement('ul', null, binding.gaps.map((gap, index) => createElement('li', { key: `${index}:${gap}` }, gap)))),
    binding.nativeCases.length === 0 ? createElement('p', { className: 'muted' }, '没有已绑定的具体用例。')
      : createElement('ul', null, nativeCases));
}
