// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#渲染
export { PanelView, panelDetail } from './view.js';
export type { PanelViewProps, BoundPanelBody } from './view.js';
export { panelItems, initialPanelState, reconcilePanelState, navigatePanel, visiblePanelItems } from './state.js';
export type { PanelState, PanelItem } from './state.js';
export { markdownToTerminal, localTarget, terminalText, wrapTerminalLine, sliceColumns } from './markdown.js';
export type { PanelConcept, TerminalMarkdown, TerminalLine, PanelLink } from './markdown.js';
export { renderPanel, PanelWorktreeUnknown, panelWorktree } from './main.js';
export type { PanelPorts, PanelGeneration, PanelReadResult, PanelSession } from './main.js';
