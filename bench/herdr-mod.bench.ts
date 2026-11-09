import type { Scope } from 'effect';
import { bench } from 'mitata';
import { pageSource } from '../src/model/herdr-mod/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(_scope: Scope.Scope): void {
  // Fixed ~4 KiB Markdown: paragraphs, definitions, images, Mermaid and p5 blocks. No host/CLI timing.
  const source = '# Read a page\n\n' + 'A Snapshot keeps current facts and a readable [reference][page].\n\n'.repeat(57)
    + '![preview](image.png)\n\n[page]: page.md\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```p5\nfunction setup() { createCanvas(100, 100); }\n```\n';
  bench('herdr-mod/page-source', () => {
    const result = pageSource(source);
    if (result.special.length !== 3) throw new Error('Page source lost its image or live blocks');
    return result;
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
