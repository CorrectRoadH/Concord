// @concord-file
// @concord-implements docs/feature/herdr-mod/use-case/read-spec.md
import { div, image, type Context, type Element } from 'gpui-kit';
import { TextView } from 'gpui-base';
import type { RenderedPage } from '../../model/herdr-mod/index.ts';

export function codeMarkdown(source: string, language: string): string {
  let length = 3;
  for (const match of source.matchAll(/`+/gu)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${language}\n${source}\n${fence}`;
}

export function renderedPageElements(page: RenderedPage, assets: ReadonlyMap<number, string>, expanded: ReadonlySet<number>, toggle: (index: number, cx: Context) => void, link: (url: string, cx: Context) => void): Element[] {
  return page.blocks.flatMap((block, index): Element[] => {
    const id = `concord-block-${page.path}-${index}`;
    const source = () => TextView.markdown(`${id}-source`, codeMarkdown(block.type === 'markdown' ? block.text : block.source, block.type === 'mermaid' ? 'mermaid' : 'typescript'));
    if (block.type === 'markdown') return [TextView.markdown(id, block.text).on_link_click(link)];
    if (block.type === 'image') return 'error' in block
      ? [div().id(id).child(`${block.alt || '图片'} · ${block.source} · ${block.error}`)]
      : assets.has(index) ? [image(assets.get(index)!).id(id).max_w_full()] : [];
    if (block.type === 'mermaid') return [
      ...('error' in block ? [div().child(block.error)] : assets.has(index) ? [image(assets.get(index)!).id(id).max_w_full()] : []),
      div().id(`${id}-toggle`).child(expanded.has(index) ? '收起 Mermaid 源码' : '展开 Mermaid 源码').on_click((_event, cx) => toggle(index, cx)),
      ...('error' in block || expanded.has(index) ? [source()] : []),
    ];
    return [
      ...(block.description ? [div().child(block.description)] : []), source(),
      ...('error' in block ? [div().child(block.error)] : assets.has(index) ? [
        div().id(`${id}-play`).child('在浏览器中播放').on_click((_event, cx) => cx.open_url(assets.get(index)!)),
      ] : []),
    ];
  });
}
