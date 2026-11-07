import { createConsumer } from '../support/consumer.ts';
import { writeProjectConfig } from '../support/support.ts';
import { initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { scanCode } from "../../src/domain/code/index.ts";
import type { Change, Repository } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";


const contract = 'docs/feature/local-sdlc/use-case/trace-code-ownership.md';
async function consumer(): Promise<string> {
  const root = (await createConsumer());
  writeProjectConfig(root, { sourceRoots: ['src', 'src'] });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord test']);
  return root;
}
function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, contents);
}
async function scan(root: string) { const repo = (await LocalRepository.open(root)); try { return (await scanCode(repo)); } finally { repo.close(); } }

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('preserves shebang, BOM, decorators, object methods, and function initializers', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/scopes.ts', ['#!/usr/bin/env node', '// @concord-file', `// @concord-implements ${contract}`, 'declare const sealed: ClassDecorator;', '// @concord-code', `// @concord-implements ${contract}`, '@sealed', 'export class Example {', '  // @concord-code', `  // @concord-implements ${contract}`, '  run() { return true; }', '}', 'const object = {', '  // @concord-code', `  // @concord-implements ${contract}`, '  execute() { return true; }', '};', '// @concord-code', `// @concord-implements ${contract}`, 'const callback = function named() { return true; };', ''].join('\n'));
    write(root, 'src/bom.ts', ['\uFEFF// @concord-file', `// @concord-implements ${contract}`, 'declare const another: ClassDecorator;', ''].join('\n'));
    const result = (await scan(root));
    assert.deepEqual(result.findings, []);
    assert.equal(result.files.length, 2);
    assert.equal(result.codes.filter(item => item.scope === 'file').length, 2);
    assert.equal(result.codes.find(item => item.symbol === 'Example')?.symbol, 'Example');
    assert.equal(result.codes.find(item => item.symbol === 'execute')?.symbol, 'execute');
    assert.equal(result.codes.find(item => item.symbol === 'callback')?.symbol, 'callback');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('supports truly anonymous default functions and computed methods without inventing names', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/anonymous.ts', ['const dynamic = "run";', '// @concord-code', `// @concord-implements ${contract}`, 'export default function () { return true; }', 'const object = {', '  // @concord-code', `  // @concord-implements ${contract}`, '  [dynamic]() { return true; }', '};', ''].join('\n'));
    const nodes = (await scan(root)).codes.filter(item => item.scope === 'node');
    assert.equal(nodes.length, 2); assert.ok(nodes.every(item => item.symbol === undefined));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('retains duplicate, unsupported, orphan, and unknown annotation findings', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/rejections.ts', [
      '// @concord-file', `// @concord-implements ${contract}`, '// @concord-file', `// @concord-implements ${contract}`,
      '// @concord-code', `// @concord-implements ${contract}`, '// @concord-code', `// @concord-implements ${contract}`, 'function duplicatedNode() {}',
      '// @concord-code', `// @concord-implements ${contract}`, 'function overloaded(value: string): string;', 'function overloaded(value: string) { return value; }',
      '// @concord-code', `// @concord-implements ${contract}`, 'const { value } = { value: () => true };',
      '// @concord-code', `// @concord-implements ${contract}`, 'const left = () => true, right = () => false;',
      '// @concord-code', `// @concord-implements ${contract}`, "overloaded('value');", `[1].map(\n  // @concord-code\n  // @concord-implements ${contract}\n  value => value + 1,\n);`,
      '// @concord-code', `// @concord-implements ${contract}`, `// @concord-implements ${contract}`, 'function duplicateContracts() {}',
      '// @concord-code', '// ordinary comment blocks ownership', `// @concord-implements ${contract}`, 'function separatedContract() {}',
      `// @concord-implements ${contract}`, '// @concord-end', '// @concord-mystery actual-unknown', `// @concord-verifies ${contract}`,
    ].join('\n'));
    const result = (await scan(root)); const codes = new Set(result.findings.map(item => item.code));
    assert.ok(codes.has('DuplicateFileCode')); assert.ok(codes.has('DuplicateNodeCode')); assert.ok(codes.has('UnsupportedCodeNode'));
    assert.ok(codes.has('OrphanCodeAnnotation')); assert.ok(codes.has('DuplicateCodeContract'));
    assert.ok(codes.has('MissingCodeContract')); assert.ok(codes.has('OrphanCodeImplements')); assert.ok(codes.has('OrphanCodeEnd')); assert.ok(codes.has('UnknownConcordAnnotation'));
    assert.ok(result.findings.some(item => item.code === 'OrphanCodeImplements' && item.message.includes('@use-case')));
    assert.ok(result.findings.some(item => item.code === 'UnknownConcordAnnotation' && item.message.includes('@concord-verifies') && item.message.includes('@feature')));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('keeps complete-region safety boundaries for empty, nested, cross-function, and partial expressions', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/regions.ts', [
      '// @concord-begin', `// @concord-implements ${contract}`, '// @concord-end',
      '// @concord-begin', `// @concord-implements ${contract}`, 'const outer = 1;', '// @concord-begin', `// @concord-implements ${contract}`, 'const inner = 2;', '// @concord-end', '// @concord-end',
      'function boundary() {', '  // @concord-begin', `  // @concord-implements ${contract}`, '  const local = true;', '}', '// @concord-end',
      'const partial =', '  // @concord-begin', `  // @concord-implements ${contract}`, '  1;', '// @concord-end', 'void outer; void inner; void boundary; void partial;',
    ].join('\n'));
    const result = (await scan(root)); const codes = new Set(result.findings.map(item => item.code));
    assert.ok(codes.has('EmptyCodeRegion')); assert.ok(codes.has('NestedCodeRegion')); assert.ok(codes.has('CodeRegionBoundary')); assert.equal(result.codes.some(item => item.scope === 'region'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('accepts terminal switch-clause regions and rejects cross-clause regions', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/switch.ts', ['switch (1) {', 'case 1:', '// @concord-begin', `// @concord-implements ${contract}`, 'console.log(1);', 'break;', '// @concord-end', 'default:', '// @concord-begin', `// @concord-implements ${contract}`, 'console.log(2);', 'break;', '// @concord-end', '}', ''].join('\n'));
    const valid = (await scan(root)); assert.deepEqual(valid.findings, []); assert.equal(valid.codes.filter(item => item.scope === 'region').length, 2);
    write(root, 'src/switch.ts', ['switch (1) {', 'case 1:', '// @concord-begin', `// @concord-implements ${contract}`, 'console.log(1);', 'default:', 'console.log(2);', '// @concord-end', '}', ''].join('\n'));
    const invalid = (await scan(root)); assert.equal(invalid.codes.length, 0); assert.ok(invalid.findings.some(item => item.code === 'CodeRegionBoundary'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('reports a non-standalone end marker instead of silently dropping the region', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/same-line-end.ts', ['// @concord-begin', `// @concord-implements ${contract}`, 'const value = 1; // @concord-end', ''].join('\n'));
    const result = (await scan(root)); assert.equal(result.codes.length, 0); assert.ok(result.findings.some(item => item.code === 'InvalidCodeAnnotation')); assert.ok(result.findings.some(item => item.code === 'CodeSourceChanged') === false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('does not bind a node across a region marker and refuses marked parse failures', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/jump.ts', ['// @concord-code', `// @concord-implements ${contract}`, '// @concord-begin', `// @concord-implements ${contract}`, 'function wrapped() {}', '// @concord-end', 'const after = 1;', ''].join('\n'));
    const jump = (await scan(root)); assert.equal(jump.codes.filter(item => item.scope === 'region').length, 1); assert.ok(jump.findings.some(item => item.code === 'CodeMarkerCrossed'));
    write(root, 'src/broken.ts', ['// @concord-code', `// @concord-implements ${contract}`, 'export function broken( {', ''].join('\n'));
    write(root, 'src/unmarked.ts', 'export function ignored( {\n');
    const broken = (await scan(root)); assert.equal(broken.codes.filter(item => item.file === 'src/broken.ts').length, 0); assert.ok(broken.findings.some(item => item.code === 'CodeParseError')); assert.ok(broken.findings.filter(item => item.code === 'CodeParseError').every(item => item.path === 'src/broken.ts'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('rebuilds cached results and observes move, delete, read drift, and disappearing files', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    const source = ['// @concord-code', `// @concord-implements ${contract}`, 'export function moving() {}', ''].join('\n');
    write(root, 'src/original.ts', source); const first = (await scan(root)); const firstId = first.codes[0]?.id; assert.ok(firstId);
    write(root, 'src/original.ts', source.replace('moving() {}', 'moving() { return 1; }')); assert.equal((await scan(root)).codes[0]?.id, firstId);
    renameSync(join(root, 'src/original.ts'), join(root, 'src/moved.ts')); assert.equal((await scan(root)).codes[0]?.file, 'src/moved.ts');
    rmSync(join(root, 'src/moved.ts')); assert.deepEqual((await scan(root)).codes, []);
    const oldSource = ['// @concord-code', `// @concord-implements ${contract}`, 'export function stale() {}', ''].join('\n');
    const freshSource = ['// @concord-code', `// @concord-implements ${contract}`, 'export function fresh() {}', ''].join('\n');
    write(root, 'src/drift.ts', oldSource); const local = (await LocalRepository.open(root)); let reads = 0;
    const drifting: Repository = { root: local.root, privateDir: local.privateDir, config: local.config, configSnapshot: local.configSnapshot, absolute: path => local.absolute(path), files: prefix => local.files(prefix), read: path => { if (path === 'src/drift.ts' && ++reads === 2) write(root, path, freshSource); return local.read(path); }, publish: async (operation: string, changes: readonly Change[], dryRun?: boolean) => (await local.publish(operation, changes, dryRun)) };
    try { const result = (await scanCode(drifting)); assert.ok(result.findings.some(item => item.code === 'CodeSourceChanged')); assert.equal(result.codes[0]?.symbol, 'fresh'); } finally { local.close(); }
    rmSync(join(root, 'src/drift.ts'));
    const disappearingLocal = (await LocalRepository.open(root)); let inventories = 0;
    const disappearing: Repository = { root: disappearingLocal.root, privateDir: disappearingLocal.privateDir, config: disappearingLocal.config, configSnapshot: disappearingLocal.configSnapshot, absolute: path => disappearingLocal.absolute(path), files: prefix => ++inventories === 1 ? ['src/vanished.ts'] : disappearingLocal.files(prefix), read: path => disappearingLocal.read(path), publish: async (operation: string, changes: readonly Change[], dryRun?: boolean) => (await disappearingLocal.publish(operation, changes, dryRun)) };
    try { const result = (await scanCode(disappearing)); assert.deepEqual(result.codes, []); assert.ok(result.findings.some(item => item.code === 'CodeSourceChanged')); } finally { disappearingLocal.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
