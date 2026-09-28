import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { buildTrace, traceGaps } from '../dist/trace.js';

// @use-case docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md
test('trace gaps distinguishes aggregate contract relations from direct documented CLI page relations', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-trace-gaps-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial, false, { sourceRoots: ['src'], testRoots: ['test'] }); } finally { initial.close(); }
    repo = new LocalRepository(root);
    createDocument(repo, 'feature', { id: 'orders', title: 'Orders', pages: ['cli'] });
    createDocument(repo, 'use-case', { id: 'create-order', title: 'Create order', feature: 'orders' });
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'src/orders.ts'), '// @concord-file\n// @concord-implements docs/feature/orders/README.md\nexport const orders = true;\n');
    writeFileSync(join(root, 'test/orders.test.ts'), "import test from 'node:test';\n// @feature docs/feature/orders/README.md\ntest('orders', () => {});\n");
    mkdirSync(join(root, 'src/node_modules'));
    symlinkSync(root, join(root, 'src/node_modules/dependency'), 'dir');

    const result = traceGaps(repo, 'off');
    assert.deepEqual(result.contracts, [{
      path: 'docs/feature/orders/use-case/create-order.md', kind: 'use-case', title: 'Create order',
      missing: ['code', 'test'], relationships: { code: 0, test: 0 },
    }]);
    assert.deepEqual(result.cliPages, [{
      path: 'docs/feature/orders/cli.md', feature: 'docs/feature/orders/README.md', title: 'Orders',
      missing: ['code', 'test'], relationships: { code: 0, test: 0 },
    }]);
    assert.equal(result.semantics, 'missing-explicit-relationships-not-coverage');
  } finally {
    repo?.close();
    rmSync(root, { recursive: true, force: true });
  }
})));

// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('shared reference targets are read once and reverified, including external edits and symlink replacement', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-reference-batch-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true });
  try {
    initialize(initial, false, { sourceRoots: ['src'], testRoots: [] });
    createDocument(initial, 'feature', { id: 'shared', title: 'Shared', pages: ['architecture'] });
  } finally { initial.close(); }
  const path = 'docs/feature/shared/architecture.md';
  const target = join(root, path);
  const original = readFileSync(target, 'utf8');
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < 60; i++) writeFileSync(join(root, `src/file-${i}.ts`), `// @concord-file\n// @concord-implements ${path}\nexport const value = ${i};\n`);
  const repo = new LocalRepository(root, { access: 'read' });
  const read = repo.read.bind(repo);
  let reads = 0;
  repo.read = file => { if (file === path) reads++; return read(file); };
  try {
    const healthy = buildTrace(repo);
    assert.equal(healthy.complete, true);
    assert.equal(healthy.edges.filter(edge => edge.to === path).length, 60);
    assert.ok(reads <= 4, `shared target had ${reads} reads for 60 references`);
    assert.throws(() => buildTrace(repo, 'use', { timing: { sync(name, operation) {
      if (name === 'trace.verifyReferences') writeFileSync(target, `${original}\nExternal edit\n`);
      return operation();
    } } }), { code: 'PreimageChanged' });
    writeFileSync(target, original);
    assert.throws(() => buildTrace(repo, 'use', { timing: { sync(name, operation) {
      if (name === 'trace.verifyReferences') { rmSync(target); symlinkSync(join(root, 'docs/constitution.md'), target); }
      return operation();
    } } }), { code: 'UnsafePath' });
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
})));
