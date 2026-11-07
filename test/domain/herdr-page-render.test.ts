import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { renderPage } from '../../src/app/index.ts';
import { digest } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

const path = 'docs/feature/render/README.md';
const theme = { background: '#102030', foreground: '#abcdef', muted: '#667788', accent: '#ff6622', ansi1: '#115599' };
async function fixture() {
  const root = await createConsumer();
  writeProjectConfig(root, { testRoots: [] });
  const repo = await LocalRepository.open(root);
  try { await createDocument(repo, 'feature', { id: 'render', title: 'Render' }); }
  finally { repo.close(); }
  const write = (relative: string, content: string | Uint8Array) => {
    const target = join(root, 'docs/feature/render', relative);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
  };
  return { root, write, render: (body: string) => { write('README.md', body); return runApplication(renderPage(root, path, theme)); } };
}

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('native page rendering preserves Markdown order and supplies concrete Mermaid colors and image bytes', async () => {
  const f = await fixture();
  try {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>');
    f.write('plot.svg', bytes);
    const body = '# Render\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![Plot](plot.svg)\n\nBetween\n\n```mermaid\nflowchart LR\nA[Start] --> B[End]\n```\n\n```ts\nconst text = "![not an image](gone.svg)";\n```\n';
    const page = await f.render(body);
    assert.equal(page.path, path);
    assert.deepEqual(page.blocks.map(block => block.type), ['markdown', 'image', 'markdown', 'mermaid', 'markdown']);
    const [first, image, middle, mermaid, last] = page.blocks;
    assert.equal(first?.type === 'markdown' && first.text, body.slice(0, body.indexOf('![Plot]')));
    assert.equal(middle?.type === 'markdown' && middle.text, '\n\nBetween\n\n');
    assert.ok(last?.type === 'markdown' && last.text.includes('![not an image]'));
    assert.ok(image?.type === 'image' && !('error' in image));
    assert.equal(image.mediaType, 'image/svg+xml'); assert.equal(image.alt, 'Plot');
    assert.equal(image.digest, digest(bytes)); assert.deepEqual(Buffer.from(image.data, 'base64'), Buffer.from(bytes));
    assert.ok(mermaid?.type === 'mermaid' && !('error' in mermaid));
    assert.match(mermaid.svg, /<svg/u); assert.doesNotMatch(mermaid.svg, /var\(/u);
    assert.match(mermaid.svg, /#abcdef/iu); assert.equal(mermaid.digest, digest(mermaid.svg));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('image failures and invalid Mermaid preserve surrounding text and do not follow symlinks', async () => {
  const f = await fixture();
  try {
    f.write('large.png', new Uint8Array(2 * 1024 * 1024 + 1));
    f.write('plain.txt', 'not an image');
    symlinkSync('/etc/passwd', join(f.root, 'docs/feature/render/link.svg'));
    const page = await f.render('# Before\n\n![Missing](missing.png)\n![Remote](https://example.com/p.png)\n![Outside](../../../../etc/passwd.svg)\n![Link](link.svg)\n![Large](large.png)\n![Unsupported](plain.txt)\n\n```mermaid\nnot-a-diagram\n```\n\nAfter\n');
    const images = page.blocks.filter(block => block.type === 'image');
    assert.equal(images.length, 6); assert.ok(images.every(block => 'error' in block && block.error.length > 0));
    const mermaid = page.blocks.find(block => block.type === 'mermaid');
    assert.ok(mermaid && 'error' in mermaid); assert.match(mermaid.error, /第 \d+ 行/u);
    const tail = page.blocks.at(-1); assert.ok(tail?.type === 'markdown' && tail.text.endsWith('After\n'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('page image output stays below the transport budget while later text is retained', async () => {
  const f = await fixture();
  try {
    f.write('two.png', new Uint8Array(2 * 1024 * 1024));
    const page = await f.render('# Budget\n\n![One](two.png)\n![Two](two.png)\n![Three](two.png)\n\nKept\n');
    const images = page.blocks.filter(block => block.type === 'image');
    assert.equal(images.filter(block => !('error' in block)).length, 2);
    assert.ok('error' in images[2]!);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 6 * 1024 * 1024);
    const tail = page.blocks.at(-1); assert.ok(tail?.type === 'markdown' && tail.text.endsWith('Kept\n'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('p5 rendering reuses strict compilation, extracts literal descriptions and creates offline sandboxed HTML', async () => {
  const f = await fixture();
  try {
    const page = await f.render('# Sketch\n\n```p5\n// p.describe("comment is not a description");\np.describe("A green square");\np.setup = () => { p.createCanvas(20, 20); p.noLoop(); };\np.draw = () => p.background("green");\n```\n\n```p5\np.describe(`Type failure`);\nconst x: number = "bad";\n```\n');
    const sketches = page.blocks.filter(block => block.type === 'p5');
    assert.equal(sketches.length, 2);
    const [good, bad] = sketches;
    assert.ok(good && !('error' in good)); assert.equal(good.description, 'A green square');
    assert.match(good.html, /sandbox="allow-scripts allow-downloads"/u);
    assert.match(good.html, /connect-src data: blob:/u); assert.match(good.html, /#102030/u);
    assert.ok(bad && 'error' in bad); assert.equal(bad.description, 'Type failure'); assert.match(bad.error, /number/u);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('a page containing many offline p5 sketches fails with the named transport-budget error', async () => {
  const f = await fixture();
  try {
    const sketch = '```p5\np.setup = () => { p.createCanvas(20, 20); p.noLoop(); };\n```\n\n';
    await assert.rejects(f.render('# Sketches\n\n' + sketch.repeat(10)), /PageRenderTooLarge|6 MiB/u);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
