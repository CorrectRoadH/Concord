import assert from 'node:assert/strict';
import { createDocument } from '../support/operations.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect } from '@playwright/test';
import { LocalRepository } from '../support/repository.ts';
import { test } from './fixtures.ts';
import { type ViewServerHandle } from './server.ts';

const sketch = `let label: import('p5').default.Element;
p.setup = () => {
  p.createCanvas(60, 30);
  document.documentElement.dataset.started = crypto.randomUUID();
  document.documentElement.dataset.initialAccent = getComputedStyle(document.documentElement).getPropertyValue('--concord-accent').trim();
  label = p.createSpan('').id('theme-sample');
};
p.draw = () => {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--concord-accent').trim();
  p.background(accent);
  label.html(String(p.frameCount)).style('color', accent);
};`;
const pie = 'pie\n "Current" : 1\n "Other" : 2';
const broken = 'flowchart LR\n A[broken';
const body = ['# Shared diagram theme', '', '```p5', sketch, '```', '', '```mermaid', pie, '```', '', '```mermaid', broken, '```', ''].join('\n');

// @use-case docs/feature/web-workbench/use-case/embed-p5-sketch.md#主题色
test('Mermaid and p5 share live theme colors without rerendering or restarting and preserve errors and source bytes', { timeout: 120000 }, ({ page, workspace }) => Effect.runPromise(Effect.tryPromise(async () => {
  const root = workspace.root;
  let server: ViewServerHandle | undefined;

  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'feature', { id: 'plain', title: 'Plain document' }));
    (await createDocument(repo, 'feature', { id: 'themed', title: 'Shared diagram theme', body }));
  } finally { repo.close(); }
  const file = join(root, 'docs/feature/themed/README.md');
  const before = readFileSync(file);
  const project = join(root, 'docs/diagrams.md');
  writeFileSync(project, '\uFEFF' + body.replaceAll('\n', '\r\n') + '\r\n$x$\r\n');
  const projectBefore = readFileSync(project);
  server = await workspace.ready();
  const address = `http://127.0.0.1:${server.port}`;
  await page.addInitScript(() => { if (window === top) localStorage.setItem('concord-theme', 'light'); });
  const loaded: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/pele|\/lazy[-.]/u.test(request.url())) loaded.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(`${address}/features/plain`);
  await expect(page.getByRole('heading', { name: 'Plain document', exact: true })).toBeVisible();
  assert.deepEqual(loaded, [], 'a document without diagrams does not load pele');

  // Exercise both the rich editor and the read-only math/document preview.
  for (const route of ['/features/themed', '/docs?file=docs%2Fdiagrams.md']) {
    await page.goto(address + route);
    const diagrams = page.getByTestId('mermaid-editor');
    await expect(diagrams).toHaveCount(2);
    const diagram = diagrams.first();
    const svg = diagram.getByLabel('Mermaid 图表预览').locator('svg');
    await expect(svg).toHaveClass(/pele-pie/u);
    await expect(diagrams.nth(1).getByRole('alert')).toContainText('第 2 行');
    await expect(diagrams.nth(1).getByRole('alert')).toContainText('Parse error');
    await diagrams.nth(1).getByText('编辑 Mermaid 源码', { exact: true }).click();
    await expect(diagrams.nth(1).locator('details')).toContainText('A[broken');
    const block = page.getByTestId('p5-sketch');
    await block.scrollIntoViewIfNeeded();
    await expect(block.getByRole('status')).toHaveText('运行中', { timeout: 30000 });
    const frame = block.frameLocator('iframe');
    const sample = frame.locator('#theme-sample');
    await expect(sample).toHaveText(/[1-9]\d*/u);
    const identity = await frame.locator('html').getAttribute('data-started');
    assert.ok(await frame.locator('html').getAttribute('data-initial-accent'), 'theme variables are available when sketch setup runs');
    const oldTicks = Number(await sample.textContent());
    const iframe = await block.locator('iframe').elementHandle();
    const svgNode = await svg.elementHandle();
    const layout = await svg.getAttribute('viewBox');
    const geometry = await svg.locator('.pele-slice').first().getAttribute('d');
    const sourceSvg = await svg.evaluate(element => element.outerHTML);
    const slice = svg.locator('.pele-slice').first();
    let lastColor = '';
    for (const theme of ['light', 'dark', 'light'] as const) {
      const button = page.getByRole('button', { name: theme === 'dark' ? '切换至深色主题' : '切换至浅色主题', exact: true });
      if (await button.count()) await button.click();
      const color = await slice.evaluate(element => getComputedStyle(element).fill);
      if (lastColor) assert.notEqual(color, lastColor, 'theme switch changes Mermaid paint');
      lastColor = color;
      await expect(sample).toHaveCSS('color', color);
      await expect(frame.locator('html')).toHaveAttribute('data-started', identity!);
      assert.equal(await svgNode!.evaluate(node => node.isConnected), true, 'the rendered SVG node survives theme changes');
      assert.equal(await iframe!.evaluate(node => node.isConnected), true, 'the sandbox iframe survives theme changes');
      assert.equal(await svg.evaluate(element => element.outerHTML), sourceSvg, 'CSS themes do not rewrite the rendered SVG');
      assert.equal(await svg.getAttribute('viewBox'), layout);
      assert.equal(await slice.getAttribute('d'), geometry);
      const expected = await sample.evaluate(element => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      });
      await expect.poll(() => frame.locator('canvas').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(1, 1, 1, 1).data))).toEqual(expected);
    }
    await expect.poll(async () => Number(await sample.textContent())).toBeGreaterThan(oldTicks);
    await diagram.getByText('编辑 Mermaid 源码', { exact: true }).click();
    await expect(diagram.locator('details')).toContainText('Current');
    await diagram.getByText('编辑 Mermaid 源码', { exact: true }).click();
    await expect(diagram.locator('details')).not.toHaveAttribute('open', '');
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(readFileSync(project), projectBefore);
  }
  assert.deepEqual(errors, []);

})));
