// @concord-file
// @concord-implements docs/feature/herdr-mod/cli.md#渲染一页
import { posix } from 'node:path';
import { Effect, Schema } from 'effect';
import type { Definition, Image, ImageReference, Code, Nodes } from 'mdast';
import { PeleError, renderAsync } from 'pele/lazy';
import { RuntimeEnvironment } from '../base/environment/index.ts';
import { Installation, sourceInstallation, sourceP5Runtime } from '../base/installation/index.ts';
import { openReadRepository } from '../base/workspace/index.ts';
import { snapshotBytes, snapshotMetadata } from '../base/sources/index.ts';
import { ConcordError, digest, failure, fromMarkdown } from '../model/index.ts';
import { WorkbenchThemeSchema, p5StandaloneDocument, type WorkbenchTheme } from '../model/p5/index.ts';
import type { RenderBlock } from '../model/herdr-mod/index.ts';
import { getViewFile } from './application.ts';
import { compileP5WithDescription } from './p5-compiler.ts';

const IMAGE_LIMIT = 2 * 1024 * 1024;
const RESULT_LIMIT = 6 * 1024 * 1024;
const mediaTypes: Readonly<Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml'>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function workbenchTheme(theme: Readonly<Record<string, string>>): WorkbenchTheme {
  const pick = (name: string, fallback: string) => theme[name] ?? fallback;
  return Schema.decodeUnknownSync(WorkbenchThemeSchema, { onExcessProperty: 'error' })({
    '--concord-bg': pick('background', '#ffffff'), '--concord-fg': pick('foreground', '#171717'),
    '--concord-muted': pick('muted', '#6e6e6e'), '--concord-accent': pick('accent', '#205ea6'),
    ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`--concord-series-${index + 1}`, pick(`ansi${index + 1}`, pick('accent', '#205ea6'))])),
    '--concord-font': 'sans-serif',
  });
}

/** Resolve Pele's private aliases as well as the public workbench variables. */
function concreteSvg(svg: string, theme: WorkbenchTheme): string {
  const values = new Map<string, string>([
    ['--pele-bg', theme['--concord-bg']], ['--pele-fg', theme['--concord-fg']], ['--pele-muted', theme['--concord-muted']],
    ['--pele-line', theme['--concord-fg']], ['--pele-surface', theme['--concord-bg']], ['--pele-surface-alt', theme['--concord-bg']],
    ['--pele-border', theme['--concord-muted']], ['--pele-accent', theme['--concord-accent']], ['--pele-font', theme['--concord-font']],
    ...Array.from({ length: 8 }, (_, index) => [`--pele-series-${index + 1}`, theme[`--concord-series-${index + 1}` as keyof WorkbenchTheme]] as const),
  ]);
  for (const match of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"]+)/gu)) values.set(match[1]!, match[2]!);
  const resolve = (source: string) => source.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/gu, (_all, name: string, fallback: string | undefined) => values.get(name) ?? fallback ?? theme['--concord-fg']);
  for (let iteration = 0; iteration < 16; iteration++) {
    for (const [name, value] of values) values.set(name, resolve(value));
    const next = resolve(svg);
    if (next === svg) break;
    svg = next;
  }
  return svg;
}

function specialNodes(source: string): { node: Image | ImageReference | Code; source: string; start: number; end: number }[] {
  const root = fromMarkdown(source);
  const definitions = new Map<string, Definition>();
  const visit = (node: Nodes, callback: (node: Nodes) => void): void => { callback(node); if ('children' in node) for (const child of node.children) visit(child, callback); };
  visit(root, node => { if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node); });
  const result: ReturnType<typeof specialNodes> = [];
  visit(root, node => {
    if (node.type !== 'image' && node.type !== 'imageReference' && !(node.type === 'code' && (node.lang === 'mermaid' || node.lang === 'p5'))) return;
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const url = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier.toLowerCase())?.url ?? node.identifier : node.value;
    result.push({ node, source: url, start, end });
  });
  return result.sort((a, b) => a.start - b.start);
}

export const renderPage = Effect.fn('page.render')(function*(root: string, path: string, colors: Readonly<Record<string, string>>) {
  const environment = yield* RuntimeEnvironment;
  const file = yield* getViewFile(root, path);
  const theme = yield* Effect.try({ try: () => workbenchTheme(colors), catch: cause => new ConcordError('InvalidInput', `Invalid page theme: ${String(cause)}`) });
  const repo = yield* openReadRepository(root, { access: 'read' });
  const nodes = yield* Effect.try({ try: () => specialNodes(file.body), catch: failure });
  const blocks: RenderBlock[] = [];
  let imageBytes = 0, baseBytes = Buffer.byteLength(JSON.stringify({ path: file.path, blocks: [] }));
  const imageError = (block: Extract<RenderBlock, { type: 'image' }>): RenderBlock => ({ type: 'image', source: block.source, alt: block.alt, error: '页面图片超过 6 MiB 输出预算' });
  // Bound retained payloads while rendering; a page may repeat thousands of images or sketches.
  const add = (input: RenderBlock) => Effect.try({ try: () => {
    let block = input;
    if (block.type === 'image' && !('error' in block)) {
      const bytes = Buffer.byteLength(JSON.stringify(block));
      if (imageBytes + bytes > RESULT_LIMIT) block = imageError(block);
      else imageBytes += bytes;
    }
    const base = block.type === 'image' && !('error' in block) ? imageError(block) : block;
    baseBytes += Buffer.byteLength(JSON.stringify(base)) + (blocks.length ? 1 : 0);
    if (baseBytes > RESULT_LIMIT) throw new ConcordError('PageRenderTooLarge', '页面文字与图解超过 6 MiB 输出预算');
    blocks.push(block);
  }, catch: failure });
  let cursor = 0;
  let runtime: string | undefined;
  for (const { node, source, start, end } of nodes) {
    if (start > cursor) yield* add({ type: 'markdown', text: file.body.slice(cursor, start) });
    cursor = end;
    if (node.type === 'image' || node.type === 'imageReference') {
      const base = { type: 'image' as const, source, alt: node.alt ?? '' };
      const read = yield* Effect.result(Effect.try({ try: () => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/iu.test(source)) throw new ConcordError('UnsafePath', '只显示仓库内的图片');
        const target = posix.normalize(posix.join(posix.dirname(file.path), decodeURIComponent(source.split(/[?#]/u)[0]!)));
        const mediaType = mediaTypes[posix.extname(target).toLowerCase()];
        if (!mediaType) throw new ConcordError('InvalidFile', '不支持的图片格式');
        return repo.snapshot(() => {
          repo.absolute(target);
          const stat = snapshotMetadata(repo, target);
          if (!stat) throw new ConcordError('FileNotFound', '图片不存在');
          if (!stat.file) throw new ConcordError('InvalidFile', '图片必须是普通文件');
          if (stat.size > IMAGE_LIMIT) throw new ConcordError('InvalidFile', '图片超过 2 MiB');
          const bytes = snapshotBytes(repo, target);
          if (!bytes) throw new ConcordError('FileNotFound', '图片不存在');
          if (bytes.byteLength > IMAGE_LIMIT) throw new ConcordError('InvalidFile', '图片超过 2 MiB');
          return { ...base, mediaType, data: Buffer.from(bytes).toString('base64'), digest: digest(bytes) };
        });
      }, catch: failure }));
      yield* add(read._tag === 'Success' ? read.success : { ...base, error: read.failure.message });
    } else if (node.lang === 'mermaid') {
      const rendered = yield* Effect.result(Effect.tryPromise({ try: () => renderAsync(source, { links: false, images: false }), catch: cause => cause }));
      if (rendered._tag === 'Success') {
        const svg = concreteSvg(rendered.success.svg, theme);
        yield* add({ type: 'mermaid', source, svg, digest: digest(svg) });
      } else {
        const cause = rendered.failure;
        const line = cause instanceof PeleError && cause.line > 0 ? cause.line : 1;
        yield* add({ type: 'mermaid', source, error: `第 ${line} 行：${cause instanceof Error ? cause.message : String(cause)}` });
      }
    } else {
      let description = '';
      const compiled = yield* Effect.result(Effect.gen(function*() {
        const compiled = yield* compileP5WithDescription(root, { document: file.path, code: source, meta: node.meta ?? '' }, value => { description = value; });
        if (runtime === undefined) {
          const installation = yield* Installation;
          runtime = sourceInstallation ? yield* Effect.tryPromise({ try: () => sourceP5Runtime(environment), catch: failure }) : yield* installation.asset('web', 'p5-runtime.js');
        }
        return { html: p5StandaloneDocument(runtime, compiled.bundle, theme), description: compiled.description };
      }));
      yield* add(compiled._tag === 'Success' ? { type: 'p5', source, ...compiled.success } : { type: 'p5', source, description, error: compiled.failure.message });
    }
  }
  if (cursor < file.body.length) yield* add({ type: 'markdown', text: file.body.slice(cursor) });
  const bounded: RenderBlock[] = blocks.map(block => block.type === 'image' && !('error' in block)
    ? imageError(block) : block);
  let size = Buffer.byteLength(JSON.stringify({ path: file.path, blocks: bounded }));
  if (size > RESULT_LIMIT) return yield* Effect.fail(new ConcordError('PageRenderTooLarge', '页面文字与图解超过 6 MiB 输出预算'));
  for (const [index, block] of blocks.entries()) {
    if (block.type !== 'image' || 'error' in block) continue;
    const delta = Buffer.byteLength(JSON.stringify(block)) - Buffer.byteLength(JSON.stringify(bounded[index]));
    if (size + delta > RESULT_LIMIT) continue;
    bounded[index] = block; size += delta;
  }
  return { path: file.path, blocks: bounded };
}, Effect.scoped);
