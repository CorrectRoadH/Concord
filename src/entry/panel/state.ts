import type { WorkspaceDisplay } from '../../model/workspace-display/index.js';
import { projectDocTitle, documentCategories } from '../../model/workspace-display/index.js';
import type { PanelConcept } from './markdown.js';

export interface PanelItem {
  readonly path: string; readonly title: string; readonly digest: string;
  readonly category: string; readonly parent?: string; readonly depth: number;
  readonly sourcePath?: string; readonly line?: number; readonly endLine?: number;
  readonly kind: 'document' | 'page' | 'code' | 'test' | 'concept' | 'diagnostic';
}
export function panelItems(model: WorkspaceDisplay): readonly PanelItem[] {
  const result: PanelItem[] = [], added = new Set<string>();
  const add = (item: PanelItem) => { if (!added.has(item.path)) { added.add(item.path); result.push(item); } };
  const document = (path: string, parent?: string) => {
    const item = model.documents.find(item => item.document.path === path)?.document;
    if (!item) return;
    const category = item.metadata.kind === 'use-case' ? 'feature' : item.metadata.kind === 'issue' ? 'docs' : item.metadata.kind;
    add({ path, title: item.metadata.title, digest: item.digest, category, ...(parent ? { parent } : {}), depth: parent ? 1 : 0, kind: 'document' });
  };
  for (const category of model.categories) for (const item of category.documents) {
    document(item.path);
    if (category.kind === 'feature') for (const child of model.features.find(tree => tree.feature.path === item.path)?.useCases ?? []) document(child.path, item.path);
  }
  // Orphan owners remain visible with their diagnostics.
  for (const item of model.documents) document(item.document.path);
  for (const page of model.supportPages) {
    const owner = result.find(item => item.path === page.documentPath);
    if (owner && page.path !== owner.path) add({ path: page.path, title: page.derivedTitle ?? page.path.split('/').at(-1)!, digest: page.digest, category: owner.category, parent: owner.path, depth: owner.depth + 1, kind: 'page' });
  }
  for (const detail of model.documents) {
    const owner = result.find(item => item.path === detail.document.path);
    if (!owner) continue;
    for (const code of detail.implementations.flatMap(group => group.codes)) {
      add({ path: `${code.file}#L${code.line}`, sourcePath: code.file, line: code.line, endLine: code.endLine, title: code.symbol ?? code.file, digest: model.sources.find(source => source.path === code.file)?.digest ?? '', category: owner.category, parent: owner.path, depth: owner.depth + 1, kind: 'code' });
    }
    for (const item of detail.tests) {
      add({ path: `${item.file}#L${item.line}`, sourcePath: item.file, line: item.line, endLine: item.markerEndLine ?? item.line, title: item.name, digest: model.sources.find(source => source.path === item.file)?.digest ?? '', category: owner.category, parent: owner.path, depth: owner.depth + 1, kind: 'test' });
    }
  }
  for (const page of model.pages) add({ path: page.path, title: projectDocTitle(page), digest: page.digest, category: 'docs', depth: 0, kind: 'page' });
  for (const finding of model.findings) if (!added.has(finding.path)) {
    const kind = documentCategories.find(category => finding.path.startsWith(`docs/${category.kind}/`))?.kind ?? 'docs';
    add({ path: finding.path, title: `${finding.path} · ${finding.code}`, digest: '', category: kind, depth: 0, kind: 'diagnostic' });
  }
  return result;
}
export interface PanelState {
  readonly selected?: string;
  readonly category: string | null;
  readonly categoryCursor: number;
  readonly focus: 'navigation' | 'body';
  readonly scroll: Readonly<Record<string, { readonly row: number; readonly column: number }>>;
  readonly filter: string;
  readonly filtering: boolean;
  readonly history: readonly { readonly selected?: string; readonly category: string | null; readonly focus: 'navigation' | 'body' }[];
  readonly concept?: PanelConcept;
  readonly message?: string;
}
export const initialPanelState: PanelState = { category: null, categoryCursor: 0, focus: 'navigation', scroll: {}, filter: '', filtering: false, history: [] };
export function reconcilePanelState(state: PanelState, previous: WorkspaceDisplay | undefined, model: WorkspaceDisplay): PanelState {
  const items = panelItems(model);
  if (state.selected && items.some(item => item.path === state.selected)) return state;
  let old = previous && panelItems(previous).find(item => item.path === state.selected);
  while (old?.parent) {
    const parent = items.find(item => item.path === old!.parent);
    if (parent) return { ...state, selected: parent.path, category: parent.category, concept: undefined };
    old = previous && panelItems(previous).find(item => item.path === old!.parent);
  }
  const first = items.find(item => item.category === state.category) ?? items[0];
  return { ...state, selected: first?.path, category: state.category === null ? null : first?.category ?? state.category, concept: undefined };
}
export function visiblePanelItems(model: WorkspaceDisplay, state: PanelState): readonly PanelItem[] {
  const items = panelItems(model).filter(item => item.category === state.category);
  const matched = items.filter(item => `${item.title} ${item.path}`.toLocaleLowerCase().includes(state.filter.toLocaleLowerCase()));
  const included = new Set(matched.map(item => item.path));
  for (const match of matched) {
    let parent = match.parent;
    while (parent) { included.add(parent); parent = items.find(item => item.path === parent)?.parent; }
  }
  return items.filter(item => included.has(item.path));
}
export function navigatePanel(state: PanelState, path: string, model: WorkspaceDisplay): PanelState {
  const item = panelItems(model).find(item => item.path === path);
  if (!item) return { ...state, message: path };
  return { ...state, selected: path, category: item.category, focus: 'body', filter: '', concept: undefined,
    history: [...state.history, { selected: state.selected, category: state.category, focus: state.focus }] };
}
