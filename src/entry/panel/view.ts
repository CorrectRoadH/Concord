import { createElement as h, type ReactElement } from 'react';
import { Box, Text } from 'ink';
import { panelLayout, type PanelViewProps } from './layout.js';

export function PanelView(props: PanelViewProps): ReactElement {
  const { state, columns } = props;
  const { wide, navigationWidth, height, nav, body, header, help, links } = panelLayout(props);
  const bodyWidth = Math.max(1, wide ? columns - navigationWidth - 3 : columns);
  const text = (value: string, key: string, active = false) => h(Text, { key, ...(props.noColor ? {} : active ? { color: 'cyan' } : {}) }, value);
  return h(Box, { flexDirection: 'column', width: columns },
    text(header, 'header', true),
    h(Box, { flexDirection: 'row', height },
      ...(wide || state.focus === 'navigation' ? [h(Box, { key: 'nav', width: navigationWidth, flexDirection: 'column' }, text(state.filtering ? `/${state.filter}\n${nav}` : nav, 'nav-text', state.focus === 'navigation'))] : []),
      ...(wide ? [text(' │ ', 'divider')] : []),
      ...(wide || state.focus === 'body' ? [h(Box, { key: 'body', width: bodyWidth, flexDirection: 'column' }, text(body, 'body-text'))] : [])),
    text(help, 'help'),
    text(links, 'links'));
}
