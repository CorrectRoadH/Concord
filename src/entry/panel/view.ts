import { createElement as h, type ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { WorkspaceDisplay } from '../../model/workspace-display/index.js';
import { markdownToTerminal, sliceColumns, terminalText, wrapTerminalLine, type PanelConcept } from './markdown.js';
import { panelItems, visiblePanelItems, type PanelState } from './state.js';

export interface BoundPanelBody {
  readonly path: string; readonly digest: string; readonly body: string;
  /** Relations and concepts frozen at the generation that accepted this body. */
  readonly model: WorkspaceDisplay;
  readonly concepts: readonly PanelConcept[];
}
export interface PanelViewProps {
  readonly model?: WorkspaceDisplay;
  readonly bodies: ReadonlyMap<string, BoundPanelBody>;
  readonly state: PanelState;
  readonly columns: number; readonly rows: number; readonly noColor?: boolean;
  readonly connection?: 'connected' | 'reconnecting' | 'building';
}
export function panelDetail(props: PanelViewProps) {
  const selected = props.model && panelItems(props.model).find(item => item.path === props.state.selected);
  const accepted = selected && props.bodies.get(selected.path);
  const matched = accepted && accepted.digest === selected?.digest;
  const lines: { text: string; literal?: boolean }[] = [];
  if (props.state.concept) {
    const concept = props.state.concept;
    const definition = markdownToTerminal(concept.definition, concept.path, new Set(props.model ? panelItems(props.model).map(item => item.path) : []));
    return { ...definition, lines: [{ text: `概念：${concept.term}` }, { text: concept.path }, ...definition.lines, ...concept.deprecated.map(term => ({ text: `弃用：${term} → ${concept.term}` }))] };
  }
  if (!selected) return { lines: [{ text: props.model ? '选择条目阅读' : '正在构建工作区投影…' }], links: [], concepts: [] };
  const diagnostics = props.model!.findings.filter(item => item.path === selected.path).map(finding => ({ text: `诊断 ${finding.code}：${finding.message}` }));
  if (!accepted) return { lines: [{ text: selected.title }, ...diagnostics, ...(selected.kind === 'diagnostic' ? [] : [{ text: selected.digest ? '正文正在更新…' : '当前正文摘要不可用，等待更新。' }])], links: [], concepts: [] };
  lines.push(...diagnostics);
  const displayed = panelItems(accepted.model).find(item => item.path === selected.path) ?? selected;
  if (!matched) lines.push({ text: '正在更新：保留上次匹配的正文与关系' });
  const paths = new Set(panelItems(accepted.model).map(item => item.path));
  const source = displayed.kind === 'code' || displayed.kind === 'test'
    ? accepted.body.split('\n').slice((displayed.line ?? 1) - 1, displayed.endLine).map((text, index) => ({ text: `${(displayed.line ?? 1) + index}  ${terminalText(text)}`, literal: true })) : undefined;
  const markdown = source ? { lines: [{ text: `${displayed.title} · ${displayed.sourcePath}:${displayed.line}–${displayed.endLine}` }, ...source], links: [], concepts: [] }
    : markdownToTerminal(accepted.body, selected.path, paths, accepted.concepts);
  const links = [...markdown.links];
  lines.push(...markdown.lines);
  const detail = accepted.model.documents.find(item => item.document.path === selected.path);
  if (detail) {
    if (detail.document.metadata.kind === 'use-case') lines.push({ text: `所属 Feature：${detail.document.metadata.feature}` });
    for (const page of accepted.model.supportPages.filter(page => page.documentPath === selected.path && page.path !== selected.path)) { links.push({ label: page.derivedTitle ?? page.path, target: page.path }); lines.push({ text: `支持页面：${page.derivedTitle ?? page.path} [${links.length}]` }); }
    const children = accepted.model.features.find(item => item.feature.path === selected.path)?.useCases ?? [];
    for (const child of children) { links.push({ label: child.metadata.title, target: child.path }); lines.push({ text: `Use Case：${child.metadata.title} [${links.length}]` }); }
    for (const group of detail.implementations) if (group.codes.length) {
      lines.push({ text: `实现 · ${group.owner.metadata.title}` });
      for (const code of group.codes) { links.push({ label: code.symbol ?? code.file, target: `${code.file}#L${code.line}` }); lines.push({ text: `${code.symbol ?? code.file} · ${code.file}:${code.line}–${code.endLine} [${links.length}]` }); }
    }
    for (const group of detail.testGroups) if (group.cases.length) {
      lines.push({ text: `测试 · ${group.owner.metadata.title}` });
      for (const item of group.cases) { links.push({ label: item.name, target: `${item.file}#L${item.line}` }); lines.push({ text: `${item.name} · ${item.file}:${item.line} · ${item.status}${item.skipped ? ' · skipped' : ''} [${links.length}]` }); }
      lines.push({ text: '测试运行状态暂不可用；关联声明不代表测试已运行。' });
    }
  }
  return { lines, links, concepts: markdown.concepts };
}
export function PanelView(props: PanelViewProps): ReactElement {
  const { state, columns, rows, model } = props;
  const wide = columns >= 60, navigationWidth = wide ? Math.min(32, Math.floor(columns * 0.36)) : columns;
  const bodyWidth = Math.max(1, wide ? columns - navigationWidth - 3 : columns), height = Math.max(1, rows - 4);
  const categoryRows = [...(model?.categories.map(category => ({ path: category.kind, title: category.label })) ?? []), { path: 'docs', title: '文档' }];
  const items = model ? visiblePanelItems(model, state) : [];
  const navigation = state.category === null ? categoryRows.map((item, index) => `${index === state.categoryCursor ? '›' : ' '} ${item.title}`) : items.map(item => `${item.path === state.selected ? '›' : ' '} ${'  '.repeat(item.depth)}${item.title}`);
  const selectedIndex = state.category === null ? state.categoryCursor : Math.max(0, items.findIndex(item => item.path === state.selected));
  const from = Math.max(0, selectedIndex - height + 1);
  const nav = navigation.slice(from, from + height).map(line => sliceColumns(terminalText(line), 0, navigationWidth)).join('\n');
  const scrollKey = state.concept ? `${state.concept.path}#${state.concept.id}` : state.selected ?? '';
  const scroll = state.scroll[scrollKey] ?? { row: 0, column: 0 };
  const detail = panelDetail(props);
  const content = [...detail.lines, ...detail.concepts.map((concept, index) => ({ text: `c${index + 1} 概念：${concept.term}` }))]
    .flatMap(line => wrapTerminalLine(line, bodyWidth, scroll.column));
  const body = content.slice(Math.min(scroll.row, Math.max(0, content.length - 1)), Math.min(scroll.row, Math.max(0, content.length - 1)) + height).join('\n');
  const status = props.connection === 'reconnecting' ? '↻ 重连中' : !model ? '… 构建中' : '● 已连接';
  const text = (value: string, key: string, active = false) => h(Text, { key, ...(props.noColor ? {} : active ? { color: 'cyan' } : {}) }, value);
  return h(Box, { flexDirection: 'column', width: columns },
    text(`Concord Spec · ${status} · ${state.focus === 'navigation' ? '导航' : '正文'}`, 'header', true),
    h(Box, { flexDirection: 'row', height },
      ...(wide || state.focus === 'navigation' ? [h(Box, { key: 'nav', width: navigationWidth, flexDirection: 'column' }, text(state.filtering ? `/${state.filter}\n${nav}` : nav, 'nav-text', state.focus === 'navigation'))] : []),
      ...(wide ? [text(' │ ', 'divider')] : []),
      ...(wide || state.focus === 'body' ? [h(Box, { key: 'body', width: bodyWidth, flexDirection: 'column' }, text(body, 'body-text'))] : [])),
    text(terminalText(state.message ?? 'j/k 移动 · Enter 进入 · Esc 返回 · / 筛选 · Tab 切栏 · q 退出'), 'help'),
    text('数字+Enter 链接 · c数字+Enter 概念 · o 在 Web 中打开', 'links'));
}
