// @concord-file
// @concord-implements docs/feature/herdr-mod/ui.md
import { div, svg, type Element } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { settings, theme } from 'herdr';
import type { ModIconName } from '../../model/herdr-mod/index.ts';

export type IconName = ModIconName;
export const color = (name: string): string => theme()[name]!;
export const text = (value: string): Element => div().child(value);
export const icon = (name: IconName): Element => svg(`mods/concord/icons/${name}.svg`).size(14).flex_none();
export const mono = (value: string): Element => text(value).font_family(settings().font_family ?? '').text_size(12);
export const heading = (value: string): Element => text(value).text_size(11).text_color(color('dim'));
export const row = (id: string): Element => h_flex().id(id).h(28).flex_none().min_w(0).px(8).gap(7).items_center().rounded(7);
export const clickableRow = (id: string): Element => row(id).cursor_pointer().hover(element => element.bg(color('hover')));

export const contextMenuCard = (x: number, y: number): Element => v_flex().id('concord-context-menu')
  .absolute().left(x).top(y).w(200).p(4).bg(color('raised'))
  .border_1().border_color(color('border')).rounded(7).shadow_md();
