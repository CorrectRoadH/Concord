// @concord-file
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
export { projectDocPages, projectDocTitle } from './workspace-display.ts';

export function projectDocHref(path: string): string {
  return `/docs?file=${encodeURIComponent(path)}`;
}
