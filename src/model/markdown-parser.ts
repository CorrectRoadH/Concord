// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
import { fromMarkdown as parse } from './markdown-dependencies.js';
export function fromMarkdown(...args: Parameters<typeof parse>): ReturnType<typeof parse> { return parse(...args); }
