import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { scanCode } from '../dist/code.js';
import type { Change, Repository } from '../dist/shared.js';
import { LocalRepository, initialize } from '../dist/storage.js';

const contract = 'docs/feature/local-sdlc/use-case/trace-code-ownership.md';

function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-code-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord test']);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { sourceRoots: ['src', 'src'] }); }
  finally { initial.close(); }
  return root;
}

function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function scan(root: string) {
  const repo = new LocalRepository(root);
  try { return scanCode(repo); }
  finally { repo.close(); }
}

// @concord-case code-parser-scopes-and-nodes
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('discovers file, nested node, and complete statement region ownership with multiple targets', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/scopes.ts', `#!/usr/bin/env node
// Copyright test fixture
// @concord-file whole-source
// @concord-implements ${contract}
// @concord-implements docs/feature/secondary.md#detail
// @concord-code exported-function
// @concord-implements ${contract}
export function outer() {
  // @concord-code arrow-binding
  // @concord-implements ${contract}
  const arrow = () => true;
  // @concord-begin setup-region
  // @concord-implements ${contract}
  const first = 1;
  const second = first + 1;
  // @concord-end setup-region
  return arrow() && second > 1;
}
// @concord-code named-class
// @concord-implements ${contract}
@sealed
export class Example {
  // @concord-code class-method
  // @concord-implements ${contract}
  run() { return true; }
}
const object = {
  // @concord-code object-method
  // @concord-implements ${contract}
  execute() { return true; }
};
// @concord-code function-binding
// @concord-implements ${contract}
const callback = function named() { return true; };
// @concord-begin function-region
// @concord-implements ${contract}
function whollyWrapped() { return true; }
// @concord-end function-region
function ownsLastBlockGap() {
  // @concord-begin last-block-region
  // @concord-implements ${contract}
  const finalStatement = true;
  // @concord-end last-block-region
}
// @concord-begin last-file-region
// @concord-implements ${contract}
const finalFileStatement = true;
// @concord-end last-file-region
`);
    write(root, 'src/bom.ts', `\uFEFF// Copyright test fixture
// @concord-file bom-source
// @concord-implements ${contract}
declare const sealed: ClassDecorator;
`);
    const result = scan(root);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.codes.map(item => item.id), ['arrow-binding', 'bom-source', 'class-method', 'exported-function', 'function-binding', 'function-region', 'last-block-region', 'last-file-region', 'named-class', 'object-method', 'setup-region', 'whole-source']);
    assert.equal(result.codes.find(item => item.id === 'whole-source')?.scope, 'file');
    assert.equal(result.codes.find(item => item.id === 'whole-source')?.line, 1);
    assert.equal(result.codes.find(item => item.id === 'whole-source')?.contracts.length, 2);
    assert.equal(result.codes.find(item => item.id === 'exported-function')?.symbol, 'outer');
    assert.equal(result.codes.find(item => item.id === 'object-method')?.symbol, 'execute');
    assert.equal(result.codes.find(item => item.id === 'named-class')?.line, 21);
    assert.equal(result.codes.find(item => item.id === 'function-region')?.scope, 'region');
    const region = result.codes.find(item => item.id === 'setup-region');
    assert.equal(region?.scope, 'region');
    assert.equal(region?.line, 14);
    assert.equal(region?.endLine, 15);
    assert.equal(result.files.length, 2);
    assert.match(result.digest, /^sha256:/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case code-parser-real-comment-boundary
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('uses TypeScript comment ranges and ignores pseudo markers plus known annotation families', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/comments.tsx', `const id = 'fake';
const stringValue = '// @concord-code string-fake';
const templateValue = \`before \${id} // @concord-code template-fake\`;
const regularExpression = /\\/\\/ @concord-code regex-fake/;
const jsx = <div>// @concord-code jsx-fake</div>;
// @concord-case ignored-test-family
// @concord-contract ${contract}
// @concord-mystery actual-unknown
// @concord-code actual-node
// @concord-implements ${contract}
const actual = () => ({ stringValue, templateValue, regularExpression, jsx });
`);
    const result = scan(root);
    assert.deepEqual(result.codes.map(item => item.id), ['actual-node']);
    assert.deepEqual(result.findings.map(item => item.code), ['UnknownConcordAnnotation']);
    assert.equal(result.findings[0]?.line, 8);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case code-parser-rejects-ambiguous-nodes
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('rejects unsupported declarations, repeated owners, invalid IDs, and orphan relation markers', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/rejections.ts', `// @concord-file first-file
// @concord-implements ${contract}
// @concord-file second-file
// @concord-implements ${contract}
// @concord-code duplicate-node-a
// @concord-implements ${contract}
// @concord-code duplicate-node-b
// @concord-implements ${contract}
function duplicatedNode() {}
// @concord-code overload-signature
// @concord-implements ${contract}
function overloaded(value: string): string;
function overloaded(value: string) { return value; }
// @concord-code destructuring-binding
// @concord-implements ${contract}
const { value } = { value: () => true };
// @concord-code multiple-bindings
// @concord-implements ${contract}
const left = () => true, right = () => false;
// @concord-code expression-owner
// @concord-implements ${contract}
overloaded('value');
[1].map(
  // @concord-code callback-owner
  // @concord-implements ${contract}
  value => value + 1,
);
// @concord-code INVALID_ID
// @concord-implements ${contract}
function invalidId() {}
// @concord-code duplicate-contracts
// @concord-implements ${contract}
// @concord-implements ${contract}
function duplicateContracts() {}
// @concord-code separated-contract
// ordinary comment blocks ownership
// @concord-implements ${contract}
function separatedContract() {}
// @concord-implements ${contract}
// @concord-end nobody
`);
    write(root, 'src/duplicate.ts', `// @concord-code duplicate-global
// @concord-implements ${contract}
export function first() {}
// @concord-code duplicate-global
// @concord-implements ${contract}
export function second() {}
`);
    const result = scan(root);
    const codes = new Set(result.findings.map(item => item.code));
    assert.ok(codes.has('DuplicateFileCode'));
    assert.ok(codes.has('DuplicateNodeCode'));
    assert.ok(codes.has('UnsupportedCodeNode'));
    assert.ok(codes.has('OrphanCodeAnnotation'));
    assert.ok(codes.has('InvalidCodeId'));
    assert.ok(codes.has('DuplicateCodeContract'));
    assert.ok(codes.has('MissingCodeContract'));
    assert.ok(codes.has('OrphanCodeImplements'));
    assert.ok(codes.has('OrphanCodeEnd'));
    assert.ok(codes.has('DuplicateCodeId'));
    assert.equal(result.codes.filter(item => item.id === 'duplicate-global').length, 2);
    assert.equal(result.codes.some(item => item.id === 'duplicate-node-a' || item.id === 'duplicate-node-b'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case code-parser-region-boundaries
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('rejects empty, nested, mismatched, cross-function, and partial-expression regions', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/regions.ts', `// @concord-begin empty-region
// @concord-implements ${contract}
// @concord-end empty-region
// @concord-begin outer-region
// @concord-implements ${contract}
const outer = 1;
// @concord-begin inner-region
// @concord-implements ${contract}
const inner = 2;
// @concord-end inner-region
// @concord-end outer-region
// @concord-begin mismatched-region
// @concord-implements ${contract}
const mismatch = 3;
// @concord-end wrong-region
function boundary() {
  // @concord-begin cross-function
  // @concord-implements ${contract}
  const local = true;
}
// @concord-end cross-function
const partial =
  // @concord-begin partial-expression
  // @concord-implements ${contract}
  1;
// @concord-end partial-expression
void outer; void inner; void mismatch; void boundary; void partial;
`);
    const result = scan(root);
    const codes = new Set(result.findings.map(item => item.code));
    assert.ok(codes.has('EmptyCodeRegion'));
    assert.ok(codes.has('NestedCodeRegion'));
    assert.ok(codes.has('MismatchedCodeRegion'));
    assert.ok(codes.has('CodeRegionBoundary'));
    assert.equal(result.codes.some(item => item.scope === 'region'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case code-parser-node-marker-barrier
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('does not bind a node marker across a region marker while retaining the wrapped function region', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/jump.ts', `// @concord-code jumped-node
// @concord-implements ${contract}
// @concord-begin wrapped-function
// @concord-implements ${contract}
function wrapped() {}
// @concord-end wrapped-function
const after = 1;
`);
    const result = scan(root);
    assert.deepEqual(result.codes.map(item => item.id), ['wrapped-function']);
    assert.ok(result.findings.some(item => item.code === 'CodeMarkerCrossed'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case code-parser-switch-boundaries
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('accepts terminal switch clause regions and rejects crossing into another clause', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const source = `switch (1) {
case 1:
// @concord-begin case-tail
// @concord-implements ${contract}
console.log(1);
break;
// @concord-end case-tail
default:
// @concord-begin default-tail
// @concord-implements ${contract}
console.log(2);
break;
// @concord-end default-tail
}
`;
    write(root, 'src/switch.ts', source);
    const valid = scan(root);
    assert.deepEqual(valid.findings, []);
    assert.deepEqual(valid.codes.map(item => [item.id, item.line, item.endLine]), [['case-tail', 5, 6], ['default-tail', 11, 12]]);
    write(root, 'src/switch.ts', `switch (1) {
case 1:
// @concord-begin crosses-case
// @concord-implements ${contract}
console.log(1);
default:
console.log(2);
// @concord-end crosses-case
}
`);
    const invalid = scan(root);
    assert.equal(invalid.codes.length, 0);
    assert.ok(invalid.findings.some(item => item.code === 'CodeRegionBoundary'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case code-parser-source-freshness
// @concord-contract docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('refuses marked parse failures and keeps moved, deleted, and concurrently changed scans fresh', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/broken.ts', `// @concord-code broken-node
// @concord-implements ${contract}
export function broken( {
`);
    write(root, 'src/unmarked.ts', 'export function ignored( {\n');
    let result = scan(root);
    assert.equal(result.codes.length, 0);
    assert.equal(result.findings.filter(item => item.code === 'CodeParseError').length > 0, true);
    assert.equal(result.findings.filter(item => item.code === 'CodeParseError').every(item => item.path === 'src/broken.ts'), true);

    rmSync(join(root, 'src/broken.ts'));
    rmSync(join(root, 'src/unmarked.ts'));
    write(root, 'src/original.ts', `// @concord-code moving-node
// @concord-implements ${contract}
export function moving() {}
`);
    result = scan(root);
    assert.equal(result.codes[0]?.file, 'src/original.ts');
    renameSync(join(root, 'src/original.ts'), join(root, 'src/moved.ts'));
    result = scan(root);
    assert.equal(result.codes[0]?.file, 'src/moved.ts');
    rmSync(join(root, 'src/moved.ts'));
    assert.deepEqual(scan(root).codes, []);

    const oldSource = `// @concord-code stale-node\n// @concord-implements ${contract}\nexport function stale() {}\n`;
    const freshSource = `// @concord-code fresh-node\n// @concord-implements ${contract}\nexport function fresh() {}\n`;
    write(root, 'src/drift.ts', oldSource);
    const local = new LocalRepository(root);
    let reads = 0;
    const drifting: Repository = {
      root: local.root,
      privateDir: local.privateDir,
      config: local.config,
      absolute: path => local.absolute(path),
      files: prefix => local.files(prefix),
      read: path => {
        if (path === 'src/drift.ts' && ++reads === 2) write(root, path, freshSource);
        return local.read(path);
      },
      publish: (operation: string, changes: readonly Change[], dryRun?: boolean) => local.publish(operation, changes, dryRun),
    };
    try {
      result = scanCode(drifting);
      assert.ok(result.findings.some(item => item.code === 'CodeSourceChanged'));
      assert.deepEqual(result.codes.map(item => item.id), ['fresh-node']);
      assert.equal(result.codes.some(item => item.id === 'stale-node'), false);
      assert.deepEqual(result.codes, scanCode(local).codes);
    } finally { local.close(); }

    rmSync(join(root, 'src/drift.ts'));
    const disappearingLocal = new LocalRepository(root);
    let inventories = 0;
    const disappearing: Repository = {
      root: disappearingLocal.root,
      privateDir: disappearingLocal.privateDir,
      config: disappearingLocal.config,
      absolute: path => disappearingLocal.absolute(path),
      files: prefix => ++inventories === 1 ? ['src/vanished.ts'] : disappearingLocal.files(prefix),
      read: path => disappearingLocal.read(path),
      publish: (operation: string, changes: readonly Change[], dryRun?: boolean) => disappearingLocal.publish(operation, changes, dryRun),
    };
    try {
      const vanished = scanCode(disappearing);
      assert.deepEqual(vanished.codes, []);
      assert.ok(vanished.findings.some(item => item.code === 'CodeSourceChanged'));
    } finally { disappearingLocal.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
