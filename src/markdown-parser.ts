// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md
// @concord-implements docs/feature/local-sdlc/use-case/compare-design-plans.md
import { createRequire } from 'node:module';
import type * as Markdown from 'mdast-util-from-markdown';

let parser: typeof Markdown | undefined;

/** List and index commands do not parse Markdown prose. Load on first use. */
export function fromMarkdown(source: string): ReturnType<typeof Markdown.fromMarkdown> {
  parser ??= createRequire(import.meta.url)('mdast-util-from-markdown') as typeof Markdown;
  return parser.fromMarkdown(source);
}
