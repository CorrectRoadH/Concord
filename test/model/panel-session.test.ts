import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { Effect } from 'effect';
import { renderPanel, type PanelGeneration, type PanelPorts } from '../../src/entry/panel/index.js';
import { workspaceDisplay } from '../../src/model/workspace-display/index.js';
import { panelSnapshot, featurePath, panelBody } from '../support/panel-fixture.js';

function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode(value: boolean) { this.isRaw = value; return this; }, ref() {}, unref() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 26 });
  const errors = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += stripVTControlCharacters(String(chunk)); });
  const waitFor = (predicate: (text: string) => boolean) => new Promise<void>((resolve, reject) => {
    const check = () => { if (predicate(text)) { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`terminal state not reached:\n${text}`)); }, 5000);
    const cleanup = () => { clearTimeout(timer); output.off('data', check); };
    output.on('data', check); check();
  });
  return { input, output, errors, waitFor, text: () => text };
}
const generation: PanelGeneration = { model: workspaceDisplay(panelSnapshot), concepts: new Map() };

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('actual panel keyboard session reads by expected digest, resizes, opens a port, and removes input/resize listeners', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const tty = terminal();
  const baseline = { input: tty.input.listenerCount('readable'), resize: tty.output.listenerCount('resize') };
  const reads: unknown[] = [], opened: string[] = [];
  const ports: PanelPorts = {
    read: request => Effect.sync(() => { reads.push(request); return { path: request.path, digest: request.expectedDigest, body: panelBody }; }),
    openInWeb: path => Effect.sync(() => { opened.push(path); return 'http://127.0.0.1:4317/features/reader'; }),
  };
  const session = yield* renderPanel(ports, generation, { stdin: tty.input, stdout: tty.output, stderr: tty.errors, debug: true, interactive: true });
  yield* Effect.promise(() => tty.waitFor(text => text.includes('Feature')));
  tty.input.write('\r'); // Enter Feature category; selecting its first item reads the body.
  yield* Effect.promise(() => tty.waitFor(text => text.includes('› 阅读 Spec')));
  yield* Effect.promise(() => tty.waitFor(text => text.includes('工作约定')));
  assert.deepEqual(reads[0], { path: featurePath, expectedDigest: 'feature-1' });
  tty.input.write('\t');
  yield* Effect.promise(() => tty.waitFor(text => text.includes('已连接 · 正文')));
  tty.input.write('o');
  yield* Effect.promise(() => tty.waitFor(text => text.includes('http://127.0.0.1:4317/features/reader')));
  assert.deepEqual(opened, [featurePath]);
  tty.output.columns = 59; tty.output.emit('resize');
  yield* session.update(undefined, true);
  yield* Effect.promise(() => tty.waitFor(text => text.includes('重连中')));
  tty.input.write('q');
  yield* session.closed;
  assert.equal(tty.input.listenerCount('readable'), baseline.input);
  assert.equal(tty.output.listenerCount('resize'), baseline.resize);
  assert.equal(tty.input.isRaw, false);
}))));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('panel scope interrupts pending read and browser effects and releases rendering resources', { timeout: 10000 }, () => Effect.runPromise(Effect.gen(function*() {
  const tty = terminal(); let readStopped = false, openStopped = false;
  let readReady!: () => void, openReady!: () => void;
  const readStarted = new Promise<void>(resolve => { readReady = resolve; });
  const openStarted = new Promise<void>(resolve => { openReady = resolve; });
  const ports: PanelPorts = {
    read: () => Effect.sync(() => readReady()).pipe(Effect.andThen(Effect.never)).pipe(Effect.ensuring(Effect.sync(() => { readStopped = true; }))),
    openInWeb: () => Effect.sync(() => openReady()).pipe(Effect.andThen(Effect.never)).pipe(Effect.ensuring(Effect.sync(() => { openStopped = true; }))),
  };
  yield* Effect.scoped(Effect.gen(function*() {
    const session = yield* renderPanel(ports, generation, { stdin: tty.input, stdout: tty.output, stderr: tty.errors, debug: true, interactive: true });
    yield* Effect.promise(() => tty.waitFor(text => text.includes('Feature')));
    tty.input.write('\r');
    yield* Effect.promise(() => tty.waitFor(text => text.includes('› 阅读 Spec')));
    yield* Effect.promise(() => readStarted);
    tty.input.write('o');
    yield* Effect.promise(() => openStarted);
    tty.input.write('q');
    yield* session.closed;
  }));
  assert.equal(readStopped, true); assert.equal(openStopped, true);
  assert.equal(tty.input.isRaw, false);
  assert.equal(tty.output.listenerCount('resize'), 0);
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('real read port rejects mismatched body and reuses path/digest cache across generation updates', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const tty = terminal(), reads: string[] = [];
  let readReady!: () => void;
  const readStarted = new Promise<void>(resolve => { readReady = resolve; });
  const ports: PanelPorts = {
    read: request => Effect.sync(() => {
      reads.push(request.expectedDigest); readReady();
      return { path: request.path, digest: 'feature-2', body: '# FUTURE_BODY\n\nOnly matched generations can show this.' };
    }),
    openInWeb: () => Effect.succeed('unused'),
  };
  const session = yield* renderPanel(ports, generation, { stdin: tty.input, stdout: tty.output, stderr: tty.errors, debug: true, interactive: true });
  yield* Effect.promise(() => readStarted);
  yield* Effect.promise(() => tty.waitFor(text => text.includes('正文正在更新')));
  assert.doesNotMatch(tty.text(), /FUTURE_BODY/u);
  const next: PanelGeneration = { ...generation, model: workspaceDisplay({ ...panelSnapshot, documents: panelSnapshot.documents.map(document => document.path === featurePath ? { ...document, digest: 'feature-2' } : document) }) };
  yield* session.update(next);
  yield* Effect.promise(() => tty.waitFor(text => text.includes('FUTURE_BODY')));
  assert.deepEqual(reads, ['feature-1', 'feature-2']);
  yield* session.update({ ...next, model: workspaceDisplay({ ...panelSnapshot, documents: panelSnapshot.documents.map(document => document.path === featurePath ? { ...document, digest: 'feature-2' } : document), codes: [], cases: [] }) }, true);
  yield* Effect.promise(() => tty.waitFor(text => text.includes('重连中')));
  assert.deepEqual(reads, ['feature-1', 'feature-2']);
  tty.input.write('q'); yield* session.closed;
}))));
