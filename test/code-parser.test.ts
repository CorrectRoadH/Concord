import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { scanCode } from '../dist/code.js';
import { LocalRepository, initialize } from '../dist/storage.js';

const contract = 'docs/feature/local-sdlc/use-case/trace-code-ownership.md';
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-code-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord test']);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { sourceRoots: ['src'] }); } finally { initial.close(); }
  return root;
}
function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, contents);
}
function scan(root: string) { const repo = new LocalRepository(root); try { return scanCode(repo); } finally { repo.close(); } }
function expected(path: string, scope: 'file' | 'node' | 'region', locator: unknown): string {
  return `code-${createHash('sha256').update(JSON.stringify(['concord.code-reference/v1', path, scope, locator])).digest('hex').slice(0, 32)}`;
}

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('derives file, node, and region references from the frozen AST tuple', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/scopes.ts', [
      '// @concord-file', `// @concord-implements ${contract}`, '// @concord-code', `// @concord-implements ${contract}`, 'export function outer() {',
      '  // @concord-code', `  // @concord-implements ${contract}`, '  const arrow = () => true;', '  // @concord-begin', `  // @concord-implements ${contract}`, '  const first = 1;', '  const second = first + 1;', '  // @concord-end', '  return arrow() && second > 1;', '}',
      '// @concord-code', `// @concord-implements ${contract}`, 'class Example {', '  // @concord-code', `  // @concord-implements ${contract}`, '  run() { return true; }', '}',
    ].join('\n') + '\n');
    const result = scan(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.codes.length, 6);
    assert.equal(result.codes.find(item => item.scope === 'file')?.id, expected('src/scopes.ts', 'file', []));
    assert.equal(result.codes.find(item => item.symbol === 'run')?.symbol, 'run');
    assert.equal(result.codes.filter(item => item.scope === 'region').length, 1);
    assert.ok(result.codes.every(item => /^code-[0-9a-f]{32}$/u.test(item.id)));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('keeps references stable across whitespace, body, and contract edits but distinguishes siblings and moves', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const source = ['// @concord-code', `// @concord-implements ${contract}`, 'function same() { return 1; }', '// @concord-code', `// @concord-implements ${contract}`, 'function same() { return 2; }', '// @concord-code', `// @concord-implements ${contract}`, 'const anonymous = () => true;', ''].join('\n');
    write(root, 'src/stable.ts', source); const ids = scan(root).codes.map(item => item.id);
    write(root, 'src/stable.ts', `\n${source.replace('return 1;', 'return 1 + 0;').replace(contract, `${contract}#detail`)}\n`);
    assert.deepEqual(scan(root).codes.map(item => item.id), ids);
    assert.equal(new Set(ids).size, ids.length);
    renameSync(join(root, 'src/stable.ts'), join(root, 'src/moved.ts'));
    assert.notDeepEqual(scan(root).codes.map(item => item.id), ids);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('freezes node and region golden references, separates same-named methods, and counts unmarked siblings', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const source = ['class First {', '  // @concord-code', `  // @concord-implements ${contract}`, '  run() { return 1; }', '}', 'class Second {', '  // @concord-code', `  // @concord-implements ${contract}`, '  run() { return 2; }', '}', '// @concord-begin', `// @concord-implements ${contract}`, 'const a = 1;', '// @concord-end', ''].join('\n');
    write(root, 'src/golden.ts', source);
    const golden = scan(root).codes;
    assert.equal(golden.find(item => item.file === 'src/golden.ts' && item.line === 4)?.id, 'code-dead40d7086fa2ace0459b7e80d2c23b');
    assert.equal(golden.find(item => item.file === 'src/golden.ts' && item.line === 9)?.id, 'code-f87b855e4b8c40828cdd5bac5ff731cc');
    assert.equal(golden.find(item => item.scope === 'region')?.id, 'code-ac6aa5e680a2a4935f9daefecdcb129f');
    const siblings = ['class Box {', '  // @concord-code', `  // @concord-implements ${contract}`, '  run() { return 1; }', '  run() { return 2; }', '  // @concord-code', `  // @concord-implements ${contract}`, '  run() { return 3; }', '}', ''].join('\n');
    write(root, 'src/siblings.ts', siblings); const withUnmarked = scan(root).codes.filter(item => item.file === 'src/siblings.ts');
    write(root, 'src/siblings.ts', siblings.replace('  run() { return 2; }\n', '')); const withoutUnmarked = scan(root).codes.filter(item => item.file === 'src/siblings.ts');
    assert.notEqual(withUnmarked.find(item => item.line > 5)?.id, withoutUnmarked.find(item => item.line > 5)?.id);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('uses valid region order and allows a later region to reuse a removed region reference', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const source = (first: boolean) => [
      ...(first ? ['// @concord-begin', `// @concord-implements ${contract}`, 'const first = 1;', '// @concord-end'] : ['const first = 1;']),
      '// @concord-begin', `// @concord-implements ${contract}`, 'const second = 2;', '// @concord-end', '',
    ].join('\n');
    write(root, 'src/regions.ts', source(true)); const before = scan(root).codes.filter(item => item.scope === 'region');
    write(root, 'src/regions.ts', source(false)); const after = scan(root).codes.filter(item => item.scope === 'region');
    assert.equal(before.length, 2); assert.equal(after.length, 1); assert.equal(after[0]?.id, before.find(item => item.line === 3)?.id);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('invalid begin still consumes its own end and cannot let the outer end pass', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/invalid-region.ts', ['// @concord-begin', `// @concord-implements ${contract}`, 'const outer = 1;', '// @concord-begin', 'const invalid = 2;', '// @concord-end', '// @concord-end', ''].join('\n'));
    const result = scan(root); assert.deepEqual(result.codes, []); assert.ok(result.findings.some(item => item.code === 'MissingCodeContract')); assert.ok(result.findings.some(item => item.code === 'NestedCodeRegion'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('filters string, template, regexp, and JSX pseudo markers', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/comments.tsx', [`const id = 'fake';`, `const stringValue = '// @concord-code string-fake';`, 'const templateValue = `before ${id} // @concord-code template-fake`;', 'const regularExpression = /\\/\\/ @concord-code regex-fake/;', 'const jsx = <div>// @concord-code jsx-fake</div>;', '// @concord-code', `// @concord-implements ${contract}`, 'const actual = () => ({ stringValue, templateValue, regularExpression, jsx });', ''].join('\n'));
    const result = scan(root); assert.equal(result.codes.length, 1); assert.deepEqual(result.findings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
