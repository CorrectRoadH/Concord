import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { Effect, Schema } from 'effect';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

const inline = `let label: import('p5').default.Element;
p.setup = () => { p.createCanvas(240, 100); label = p.createSpan('0'); label.id('ticks'); p.createButton('重新绘制').class('restart').mousePressed(() => p.redraw()); p.createButton('关闭循环').mousePressed(() => p.noLoop()); };
p.draw = () => { p.background(255, 0, 0); label.html(String(p.frameCount)); };`;
const external = `import image from './pixel.svg';
export default function(p) {
  brush.instance(p);
  p.setup = async () => {
    p.createCanvas(240, 120, p.WEBGL); p.background(255); brush.load();
    brush.set('HB', '#333333', 1); brush.line(-50, -20, 50, 20);
    p.createImg(image, 'local pixel');
    p.createButton('启动声音').mousePressed(async () => {
      await p.userStartAudio();
      const oscillator = new p5.Oscillator('sine');
      const fft = new p5.FFT();
      oscillator.start(); oscillator.amp(0.01); oscillator.freq(220);
      p.createSpan('audio:' + p.getAudioContext().state + ':' + fft.analyze().length).id('audio-result');
    });
    p.createSpan(window.localAddon).id('local-addon');
    p.noLoop();
  };
}`;

// @use-case docs/feature/web-workbench/use-case/embed-p5-sketch.md
test('packed CLI runs isolated p5 sketches with project libraries, resources, CSS and project Markdown', { timeout: 180000 }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-p5-browser-'));
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  let exited: Promise<void> | undefined;
  try {
    const pack = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ filename: Schema.String }))))(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60000 }));
    const tool = join(scratch, 'tool'); mkdirSync(tool);
    writeFileSync(join(tool, 'package.json'), '{"private":true}');
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, pack[0]!.filename)], { cwd: tool, encoding: 'utf8', timeout: 60000 });
    const root = join(scratch, 'consumer'); mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    const write = (path: string, value: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
    const repo = new LocalRepository(root, { initialize: true });
    const body = '# Interactive sketches\n\n```p5 css="./demo/style.css"\n' + inline + '\n```\n\n```p5 mode="global"\nfunction setup() { createCanvas(40, 40, WEBGL); background(0, 255, 0); noLoop(); createSpan("global ready"); }\n```\n';
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'feature', { id: 'sketch', title: 'Interactive sketches', body });
      createDocument(repo, 'feature', { id: 'sketch-webgl', title: 'Brush sketch', body: '# Brush sketch\n\n```p5 src="../sketch/demo/main.js"\n```\n' });
    }
    finally { repo.close(); }
    writeProjectConfig(root, { ...readProjectConfig(root), p5: { libraries: ['p5.sound'] } });
    write('vendor/addon.js', 'window.localAddon = "local extension ready";');
    write('docs/feature/sketch/demo/main.js', external);
    write('docs/feature/sketch/demo/style.css', '.restart { background: rgb(1, 2, 3); color: white; padding: 12px; border-radius: 8px; }');
    write('docs/feature/sketch/demo/pixel.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>');
    const constitution = readFileSync(join(root, 'docs/constitution.md'), 'utf8');
    write('docs/constitution.md', constitution + '\n\n```p5 src="./feature/sketch/demo/main.js"\n```\n\n<pre><code class="language-p5">spoofed p5 source</code></pre>\n');
    const projectSketch = '# Project sketch\n\n```p5 src="./feature/sketch/demo/main.js"\n```\n';
    write('docs/sketch.md', projectSketch);
    const before = readFileSync(join(root, 'docs/feature/sketch/README.md'), 'utf8');
    const cli = join(tool, 'node_modules/concord-sdlc/dist/entry.js');
    server = spawn(process.execPath, [cli, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    exited = new Promise(done => server!.once('exit', () => done()));
    let output = ''; let errors = '';
    server.stdout!.on('data', chunk => { output += String(chunk); });
    server.stderr!.on('data', chunk => { errors += String(chunk); });
    await expect.poll(() => /"port"\s*:\s*(\d+)/u.exec(output)?.[1], { timeout: 20000, message: 'packed CLI starts view server' }).toBeTruthy();
    const address = `http://127.0.0.1:${/"port"\s*:\s*(\d+)/u.exec(output)![1]}`;
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes("font-src 'self'")) consoleErrors.push(message.text().slice(0, 500)); });
    await page.addInitScript(() => window.addEventListener('securitypolicyviolation', event => {
      const target = window as unknown as { __p5Violations?: string[] };
      (target.__p5Violations ??= []).push(`${event.violatedDirective}: ${event.blockedURI}: ${event.sourceFile}:${event.lineNumber}`);
    }));
    await page.goto(`${address}/features/sketch`);
    const blocks = page.getByTestId('p5-sketch');
    await expect(blocks).toHaveCount(2, { timeout: 20000 });
    await expect(blocks.nth(0).getByRole('button', { name: '运行 p5', exact: true })).toHaveCount(0);
    await expect.poll(async () => {
      const block = blocks.nth(0);
      const status = await block.getByRole('status').textContent();
      if (status === '运行失败') {
        const frame = page.frames().find(candidate => candidate.url().endsWith('/p5-frame'));
        const violations = await frame?.evaluate(() => (window as unknown as { __p5Violations?: string[] }).__p5Violations);
        throw new Error(`p5 startup failed: ${await block.getByRole('alert').textContent()}; policy violations: ${violations?.join('; ')}; browser errors: ${pageErrors.join('; ')}; console errors: ${consoleErrors.join('; ')}; server stderr: ${errors.slice(-1000)}`);
      }
      return status;
    }, { timeout: 20000 }).toBe('运行中');
    const first = blocks.nth(0).frameLocator('iframe');
    await expect(first.locator('canvas')).toBeVisible();
    assert.equal(await first.locator('canvas').evaluate(() => (window as unknown as { p5: { VERSION: string } }).p5.VERSION), '2.3.4');
    await expect(first.locator('.restart')).toHaveCSS('background-color', 'rgb(1, 2, 3)');
    await expect.poll(async () => Number(await first.locator('#ticks').textContent())).toBeGreaterThan(1);
    assert.deepEqual(await first.locator('canvas').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(5, 5, 1, 1).data)), [255, 0, 0, 255]);
    await blocks.nth(0).evaluate(element => { element.style.transform = 'translateX(-10000px)'; });
    await page.waitForTimeout(100);
    const paused = await first.locator('#ticks').textContent();
    await page.waitForTimeout(150);
    assert.equal(await first.locator('#ticks').textContent(), paused);
    await blocks.nth(0).evaluate(element => { element.style.transform = ''; });
    await expect.poll(async () => Number(await first.locator('#ticks').textContent())).toBeGreaterThan(Number(paused));
    await first.getByRole('button', { name: '关闭循环' }).click();
    await page.waitForTimeout(100);
    const stoppedBySketch = await first.locator('#ticks').textContent();
    await blocks.nth(0).evaluate(element => { element.style.transform = 'translateX(-10000px)'; });
    await page.waitForTimeout(100);
    await blocks.nth(0).evaluate(element => { element.style.transform = ''; });
    await page.waitForTimeout(250);
    assert.equal(await first.locator('#ticks').textContent(), stoppedBySketch);
    await first.getByRole('button', { name: '重新绘制' }).click();
    await expect.poll(async () => Number(await first.locator('#ticks').textContent())).toBeGreaterThan(Number(stoppedBySketch));
    await page.reload();
    await expect(blocks.nth(0).frameLocator('iframe').locator('#ticks')).toHaveText(/[1-9]\d*/, { timeout: 20000 });
    await expect(blocks.nth(1).frameLocator('iframe').getByText('global ready')).toBeVisible({ timeout: 20000 });
    writeProjectConfig(root, { ...readProjectConfig(root), p5: { libraries: ['p5.sound', 'p5.brush', './vendor/addon.js'] } });
    await page.goto(`${address}/features/sketch-webgl`);
    // A changed config invalidates navigation until its asynchronous projection is rebuilt.
    await expect(blocks).toHaveCount(1, { timeout: 60000 });
    const second = blocks.nth(0).frameLocator('iframe');
    await expect(second.locator('#local-addon')).toHaveText('local extension ready', { timeout: 20000 });
    await expect(second.locator('canvas')).toBeVisible();
    assert.equal(await second.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).getContext('webgl2') !== null), true);
    await expect(second.getByRole('img', { name: 'local pixel' })).toBeVisible();
    await second.getByRole('button', { name: '启动声音' }).click();
    await expect(second.locator('#audio-result')).toHaveText(/audio:running:[1-9]\d*/, { timeout: 10000 });
    const sandboxFrame = page.frames().find(frame => frame.url().endsWith('/p5-frame'))!;
    assert.equal(await sandboxFrame.evaluate(() => { try { void parent.document.body; return false; } catch { return true; } }), true);
    assert.equal(await sandboxFrame.evaluate(async address => { try { await fetch(address + '/api/workspace'); return false; } catch { return true; } }, address), true);
    const directFrame = await page.request.get(address + '/api/workspace', { headers: { 'sec-fetch-dest': 'iframe' } });
    assert.equal(directFrame.status(), 403);
    assert.equal(readFileSync(join(root, 'docs/feature/sketch/README.md'), 'utf8'), before);
    await page.goto(`${address}/docs?file=docs%2Fconstitution.md`);
    // Frontmatter documents preserve their raw source in the project Markdown editor.
    await expect(page.getByRole('textbox', { name: 'Markdown 原文', exact: true })).toHaveValue(readFileSync(join(root, 'docs/constitution.md'), 'utf8'));
    await expect(blocks).toHaveCount(0);
    await page.goto(`${address}/docs?file=docs%2Fsketch.md`);
    await expect(blocks).toHaveCount(1, { timeout: 20000 });
    await expect(blocks.frameLocator('iframe').locator('#local-addon')).toHaveText('local extension ready', { timeout: 20000 });
    assert.equal(readFileSync(join(root, 'docs/sketch.md'), 'utf8'), projectSketch);
    await page.goto(`${address}/settings`);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'p5 扩展库' })).toHaveValue('p5.sound\np5.brush\n./vendor/addon.js');
    await page.getByRole('textbox', { name: 'p5 扩展库' }).fill('p5.sound');
    await expect.poll(() => readProjectConfig(root).p5?.libraries).toEqual(['p5.sound']);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      const kill = setTimeout(() => { server?.kill('SIGKILL'); }, 5000);
      try { await exited; } finally { clearTimeout(kill); }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
})));
