// @concord-file
// @concord-implements docs/feature/herdr-mod/use-case/read-spec.md
import { div, image, type Context, type Element } from 'gpui-kit';
import { TextView } from 'gpui-base';
import type { PageSource, RenderedPage, SourceBlock } from '../../model/herdr-mod/index.ts';
import { clickableRow, color, text } from './ui.ts';

export function codeMarkdown(source: string, language: string): string {
  let length = 3;
  for (const match of source.matchAll(/`+/gu)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${language}\n${source}\n${fence}`;
}
export function livePreviewElements(source: string, parsed: PageSource, path: string, page: RenderedPage | undefined, renderedIndexes: ReadonlyMap<string, number>, assets: ReadonlyMap<number, string>, active: { block: SourceBlock; element: Element } | undefined, edit: (block: SourceBlock, cx: Context) => void, link: (url: string, cx: Context) => void, loading = false, error = ''): Element[] {
  return parsed.blocks.map((block, index) => {
    if (active?.block.start === block.start) return active.element;
    const id = `concord-block-${path}-${index}`;
    const markdown = (value: string, suffix = '') => TextView.markdown(`${id}${suffix}`, parsed.definitions ? `${value}\n\n${parsed.definitions}` : value)
      .on_link_click((url, cx) => { cx.stop_propagation(); link(url, cx); });
    const children: Element[] = [];
    if (block.literal) children.push(markdown(codeMarkdown(source.slice(block.start, block.end), 'markdown')));
    else {
      let cursor = block.start;
      for (const special of parsed.special.filter(item => item.start >= block.start && item.end <= block.end)) {
        if (special.start > cursor) children.push(markdown(source.slice(cursor, special.start), `-${cursor}`));
        const type = special.node.type === 'code' ? special.node.lang : 'image';
        const renderedIndex = renderedIndexes.get(source.slice(special.start, special.end)) ?? -1;
        const rendered = page?.blocks[renderedIndex];
        const asset = rendered?.type === type ? assets.get(renderedIndex) : undefined;
        if (rendered && 'error' in rendered) children.push(text(rendered.error).text_color(color('blocked')));
        if (asset && (type === 'image' || type === 'mermaid')) children.push(image(asset).max_w_full());
        else if (!rendered && loading && (type === 'image' || type === 'mermaid')) {
          children.push(text(type === 'image' ? '正在加载图片…' : '正在渲染图表…').text_color(color('dim')).min_h(96));
        } else {
          if (!rendered && error) children.push(text(error).text_color(color('blocked')));
          if (rendered?.type === 'p5' && rendered.description) children.push(text(rendered.description));
          children.push(markdown(codeMarkdown(source.slice(special.start, special.end), 'markdown'), `-${special.start}-source`));
          if (asset && type === 'p5') children.push(clickableRow(`${id}-play`).child(text('在浏览器中播放')).on_click((_event, cx) => { cx.stop_propagation(); cx.open_url(asset); }));
        }
        cursor = special.end;
      }
      if (cursor < block.end) children.push(markdown(source.slice(cursor, block.end), children.length ? `-${cursor}` : ''));
      if (!children.length) children.push(text('点击开始输入').text_color(color('dim')));
    }
    return div().id(`preview-block-${block.start}`).min_w(0).min_h(24).children(children)
      .on_click((_event, cx) => { cx.stop_propagation(); edit(block, cx); });
  });
}
