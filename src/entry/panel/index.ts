// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#渲染
export { panelDetail, plainPanelFrame } from './layout.js';
export type { PanelViewProps, BoundPanelBody } from './layout.js';
export { panelItems, initialPanelState, reconcilePanelState, navigatePanel, visiblePanelItems } from './state.js';
export type { PanelState, PanelItem } from './state.js';
export { markdownToTerminal, localTarget, terminalText, wrapTerminalLine, sliceColumns } from './markdown.js';
export type { PanelConcept, TerminalMarkdown, TerminalLine, PanelLink } from './markdown.js';
export { renderPanel } from './main.js';
export { serveWorkspacePanel } from './main.js';
export type { PanelPorts, PanelGeneration, PanelReadResult, PanelSession } from './ports.js';
export { PanelWorktreeUnknown, PanelHerdrUnavailable, panelWorktree, panelOpenCommand, openHerdrPanel, bindHerdrManifest, pluginDestinationAllowed } from './herdr.js';
