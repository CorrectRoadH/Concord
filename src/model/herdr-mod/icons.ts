// @concord-file
// @concord-implements docs/feature/herdr-mod/ui.md#外观
export const modIconNames = ['chevron-down', 'chevron-right', 'folder', 'file-text', 'route', 'flask-conical', 'code', 'panel-left-close', 'panel-left-open', 'copy', 'x'] as const;
export type ModIconName = typeof modIconNames[number];
