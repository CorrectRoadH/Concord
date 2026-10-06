import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createDocument, resolveReference } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { buildTrace, documentShow, renderReview, requireValidTrace, traceGaps, traceShow } from '../dist/trace.js';
import { referenceResolver } from '../dist/refs.js';

function naiveGaps(repo: LocalRepository) {
  return repo.snapshot(() => {
    const trace = buildTrace(repo, 'off'); requireValidTrace(trace);
    const counts = (matches: (ref: string) => boolean) => ({
      code: trace.edges.filter(edge => edge.relation === 'implements' && matches(edge.to)).length,
      test: trace.edges.filter(edge => edge.relation === 'contract' && matches(edge.to)).length,
    });
    const missing = (value: { code: number; test: number }) => [
      ...(value.code === 0 ? ['code'] : []), ...(value.test === 0 ? ['test'] : []),
    ];
    return {
      contracts: trace.documents.flatMap(document => {
        if (document.metadata.kind !== 'feature' && document.metadata.kind !== 'use-case') return [];
        const relationships = counts(ref => {
          const owner = resolveReference(repo, trace.documents, ref);
          return owner.path === document.path || (owner.metadata.kind === 'use-case' && owner.metadata.feature === document.path);
        });
        const gaps = missing(relationships);
        return gaps.length ? [{ path: document.path, kind: document.metadata.kind, title: document.metadata.title, missing: gaps, relationships }] : [];
      }),
      cliPages: trace.documents.flatMap(document => {
        if (document.metadata.kind !== 'feature') return [];
        const path = document.path.replace(/\/README\.md$/u, '/cli.md');
        if (path === document.path || repo.read(path) === undefined) return [];
        const relationships = counts(ref => ref.split('#')[0] === path);
        const gaps = missing(relationships);
        return gaps.length ? [{ path, feature: document.path, title: document.metadata.title, missing: gaps, relationships }] : [];
      }),
    };
  });
}

function withTraceConsumer(run: (repo: LocalRepository, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-derived-trace-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try {
      initialize(initial, false, { sourceRoots: ['src'], testRoots: ['test'] });
      createDocument(initial, 'feature', { id: 'shared', title: 'Shared', pages: ['cli', 'architecture'] });
      createDocument(initial, 'use-case', { id: 'flow', title: 'Flow', feature: 'shared' });
      createDocument(initial, 'feature', { id: 'empty', title: 'Empty', pages: ['cli'] });
    } finally { initial.close(); }
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    repo = new LocalRepository(root, { access: 'read' });
    run(repo, root);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md
test('single-pass gaps preserve naive output, edge multiplicity, Use Case aggregation and exact CLI paths', () => Effect.runPromise(Effect.sync(() => withTraceConsumer((repo, root) => {
  const flow = 'docs/feature/shared/use-case/flow.md';
  const page = 'docs/feature/shared/cli.md';
  writeFileSync(join(root, page), '# CLI\n\n## Run\n');
  for (let i = 0; i < 12; i++) writeFileSync(join(root, `src/flow-${i}.ts`), `// @concord-file\n// @concord-implements ${flow}\nexport const value = ${i};\n`);
  for (let i = 0; i < 7; i++) writeFileSync(join(root, `src/cli-${i}.ts`), `// @concord-file\n// @concord-implements ${page}#run\nexport const value = ${i};\n`);
  writeFileSync(join(root, 'test/empty.ts'), '// @feature docs/feature/empty/cli.md\n');
  const result = traceGaps(repo, 'off');
  assert.equal(JSON.stringify({ contracts: result.contracts, cliPages: result.cliPages }), JSON.stringify(naiveGaps(repo)));
  assert.deepEqual(result.contracts.find(item => item.path === 'docs/feature/shared/README.md')?.relationships, { code: 19, test: 0 });
  assert.deepEqual(result.contracts.find(item => item.path === flow)?.relationships, { code: 12, test: 0 });
  assert.deepEqual(result.cliPages.find(item => item.path === page)?.relationships, { code: 7, test: 0 });
  assert.deepEqual(result.cliPages.find(item => item.path === 'docs/feature/empty/cli.md')?.relationships, { code: 0, test: 1 });
}))));

// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('every derived trace reuses repeated exact references and releases its memo between calls', () => Effect.runPromise(Effect.sync(() => withTraceConsumer((repo, root) => {
  const path = 'docs/feature/shared/architecture.md';
  writeFileSync(join(root, path), '# Architecture\n\n## Shared\n');
  for (let i = 0; i < 60; i++) {
    writeFileSync(join(root, `src/file-${i}.ts`), `// @concord-file\n// @concord-implements ${path}#shared\nexport const value = ${i};\n`);
    writeFileSync(join(root, `test/file-${i}.ts`), `// @feature ${path}#shared\n`);
  }
  const read = repo.read.bind(repo);
  let reads = 0;
  repo.read = file => { if (file === path) reads++; return read(file); };
  const operations = [() => traceGaps(repo, 'off'), () => traceShow(repo, 'shared', 'off'), () => documentShow(repo, 'shared', 'feature', 'off'), () => renderReview(repo, 'shared', 'off')];
  for (const operation of operations) {
    reads = 0; operation();
    assert.ok(reads <= 5, `shared target had ${reads} reads for 120 references`);
    assert.ok(reads > 0, 'each invocation must read its own sources');
  }
  writeFileSync(join(root, path), '# Architecture\n');
  for (const operation of [operations[0]!, operations[1]!, operations[3]!]) assert.throws(operation, { code: 'TraceInvalid' });
  assert.equal(documentShow(repo, 'shared', 'feature', 'off').complete, false);
}))));

// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('partial derived relationships retain healthy endpoints and reject malformed nested boundaries', () => Effect.runPromise(Effect.sync(() => withTraceConsumer((repo, root) => {
  const orphan = join(root, 'docs/feature/shared/use-case/flow.md');
  writeFileSync(orphan, readFileSync(orphan, 'utf8').replace('feature: docs/feature/shared/README.md', 'feature: docs/feature/missing/README.md'));
  const nested = join(root, 'docs/feature/shared/nested'); mkdirSync(nested);
  writeFileSync(join(nested, 'README.md'), '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
  writeFileSync(join(nested, 'page.md'), '# Page\n');
  writeFileSync(join(root, 'src/broken.ts'), '// @concord-file\n// @concord-implements docs/feature/shared/nested/page.md\nexport const broken = 1;\n');
  writeFileSync(join(root, 'src/healthy.ts'), '// @concord-file\n// @concord-implements docs/feature/shared/architecture.md\nexport const healthy = 1;\n');
  const result = documentShow(repo, 'shared', 'feature', 'off');
  assert.equal(result.complete, false);
  assert.equal(result.codeDeclarations.length, 1);
  assert.equal(result.incoming.filter(edge => edge.relation === 'implements').length, 1);
  assert.ok(result.findings.some(finding => finding.code === 'ReferenceNotFound' && finding.path.endsWith('/flow.md')));
  assert.throws(() => traceGaps(repo, 'off'), { code: 'TraceInvalid' });
}))));

// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('memoized owners retain target-kind gates, anchor validation and final byte rechecks', () => Effect.runPromise(Effect.sync(() => withTraceConsumer((repo, root) => {
  const trace = buildTrace(repo, 'off');
  const path = 'docs/feature/shared/architecture.md';
  const references = referenceResolver(repo, trace.documents);
  const read = repo.read.bind(repo); let reads = 0;
  repo.read = file => { if (file === path) reads++; return read(file); };
  const owner = references.resolve(path, ['feature']);
  assert.equal(references.resolve(path), owner);
  assert.equal(references.resolve(path, ['feature', 'use-case']), owner);
  assert.equal(reads, 1);
  assert.throws(() => references.resolve(path, ['memory']), { code: 'InvalidReferenceTarget' });
  assert.throws(() => references.resolve(`${path}#absent`), { code: 'AnchorNotFound' });
  writeFileSync(join(root, path), '# Changed\n');
  assert.ok(references.verify().some(finding => finding.code === 'PreimageChanged' && finding.path === path));
}))));

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
