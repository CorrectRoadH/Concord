import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { traceGaps } from '../dist/trace.js';

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
