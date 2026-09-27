import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { compileP5 } from '../dist/p5-compiler.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

// @use-case docs/feature/web-workbench/use-case/embed-p5-sketch.md
test('p5 compiler checks captured modules, resources, options and repository boundaries without executing code', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-p5-compiler-'));
  const document = 'docs/feature/sketch/README.md';
  const write = (path: string, source: string | Buffer) => { const target = join(root, 'docs/feature/sketch', path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source); };
  const compile = (code: string, meta = '') => Effect.runPromise(compileP5(root, { document, code, meta }));
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); createDocument(repo, 'feature', { id: 'sketch', title: 'Sketch' }); }
    finally { repo.close(); }
    const before = readFileSync(join(root, document), 'utf8');
    const inline = await compile('p.setup = () => { p.createCanvas(20, 20); p.noLoop(); }; p.draw = () => p.background(30);');
    assert.match(inline.javascript, /createCanvas/);
    assert.equal(inline.mode, 'instance');
    write('demo/shape.ts', 'export type Coordinates = { x: number; y: number };');
    write('demo/types.d.ts', 'export type Size = { width: number; height: number };');
    const complete = await compile('import type P5 from "p5"; import type { Coordinates } from "./demo/shape"; import type { Size } from "./demo/types.d.ts"; export default function(p: P5) { const point: Coordinates = { x: 4, y: 5 }; const size: Size = { width: 20, height: 20 }; p.setup = () => { p.createCanvas(size.width, size.height); p.circle(point.x, point.y, 2); }; }');
    assert.equal(complete.mode, 'instance');
    assert.match(complete.javascript, /createCanvas/);
    assert.ok(complete.files.includes('docs/feature/sketch/demo/shape.ts'));
    assert.ok(complete.files.includes('docs/feature/sketch/demo/types.d.ts'));
    await assert.rejects(compile('import type { Missing } from "./demo/not-found"; p.setup = () => p.noLoop();'), /not found/);
    await assert.rejects(compile('import type { Coordinates } from "./demo/shape"; const point: Coordinates = { x: "bad", y: 5 }; p.setup = () => p.noLoop();'), /P5TypeError|not assignable/);
    await assert.rejects(compile('x'.repeat(256 * 1024 + 1)), /length of at most 262144|P5BudgetExceeded/);
    write('demo/budget.txt', Buffer.alloc(8 * 1024 * 1024 - 16, 120));
    await assert.rejects(compile('import value from "./demo/budget.txt"; p.setup = () => p.noLoop();'), /P5BudgetExceeded|Sketch inputs exceed/);
    const global = await compile('function setup() { createCanvas(20, 20); noLoop(); }', 'mode="global"');
    assert.match(global.javascript, /Object.assign\(window/);
    write('demo/color.ts', 'export const color: number = 90;');
    write('demo/style.css', 'canvas { border: 2px solid red; background-image: url("./pixel.png"); }');
    write('demo/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'));
    write('demo/main.ts', 'import type P5 from "p5"; import { color } from "./color.js"; import image from "./pixel.png"; export default function(p: P5) { p.setup = async () => { p.createCanvas(10, 10); p.background(color); await p.loadImage(image); }; }');
    const external = await compile('', 'src="./demo/main.ts" css="./demo/style.css"');
    assert.match(external.css, /data:image\/png/);
    assert.ok(external.files.includes('docs/feature/sketch/demo/color.ts'));
    assert.match(external.javascript, /data:image\/png/);
    write('addon.js', 'window.customAddon = true;');
    writeProjectConfig(root, { ...readProjectConfig(root), p5: { libraries: ['p5.sound', 'p5.brush', './docs/feature/sketch/addon.js'] } });
    const libraries = await compile('p.setup = () => p.noLoop();');
    assert.deepEqual(libraries.libraries.map(library => library.name), ['p5.sound@0.4.1', 'p5.brush@2.2.3', 'docs/feature/sketch/addon.js']);
    await assert.rejects(compile('p.setup = () => { const value: number = "wrong"; };'), /P5TypeError|not assignable/);
    await assert.rejects(compile('p.setup = () => {'), /Unexpected|Expected/);
    const unexecuted = await compile('throw new Error("do not execute");');
    assert.match(unexecuted.javascript, /do not execute/);
    await assert.rejects(compile('x', 'src="./demo/main.ts"'), /either src or inline/);
    await assert.rejects(compile('', 'src="../../../../etc/passwd.ts"'), /Unsupported sketch path|not found/);
    await assert.rejects(compile('', 'src="./.secret.ts"'), /Unsupported sketch path/);
    await assert.rejects(compile('', 'src="https://example.com/main.ts"'), /relative repository imports/);
    await assert.rejects(compile('import "react";'), /relative repository imports/);
    await assert.rejects(compile('', 'libraries="p5.sound"'), /libraries belong in project configuration/);
    writeProjectConfig(root, { ...readProjectConfig(root), p5: { libraries: ['unknown'] } });
    await assert.rejects(compile(''), /Unknown bundled library/);
    writeProjectConfig(root, { ...readProjectConfig(root), p5: { libraries: [] } });
    await assert.rejects(compile('', 'mode="global" mode="instance"'), /unique/);
    symlinkSync(join(root, 'docs/feature/sketch/demo'), join(root, 'docs/feature/sketch/linked'));
    await assert.rejects(compile('', 'src="./linked/main.ts"'), /Symbolic links/);
    assert.equal(readFileSync(join(root, document), 'utf8'), before);
    const writable = new LocalRepository(root);
    try { writable.snapshot(() => assert.ok(writable.read(document))); } finally { writable.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
