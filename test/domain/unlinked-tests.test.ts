import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { initialize, createDocument } from '../support/operations.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';
import { collectNativeTests } from '../../src/domain/tests/index.ts';
import { traceGaps } from '../../src/app/index.ts';

// @use-case docs/feature/local-sdlc/use-case/find-unlinked-tests.md#list
test('trace gaps uses real collected inventories, exact bindings, retired and Engineering exclusions, and stale file fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-unlinked-tests-'));
  const gaps = () => { const repo = new LocalRepository(root); try { return traceGaps(repo, 'off'); } finally { repo.close(); } };
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try {
      initialize(initial, false, { testRoots: ['test'], sourceRoots: [] });
      createDocument(initial, 'feature', { id: 'cart', title: 'Cart' });
      createDocument(initial, 'engineering', { id: 'testing', title: 'Testing' });
    } finally { initial.close(); }
    assert.equal(Object.hasOwn(gaps(), 'unlinkedTests'), false);
    assert(gaps().limitations.some(value => value.includes('test discover')));
    mkdirSync(join(root, 'test'));
    const sources = {
      'mixed.ts': "// @feature docs/feature/cart/README.md\nconst linked = true;\n\nconst unlinked = true;\n",
      'bare.ts': 'const unlinked = true;\n',
      'retired.ts': '// @feature docs/feature/cart/README.md\n// @status retired\nconst retired = true;\n',
      'engineering.ts': '// @feature docs/engineering/testing/README.md\nconst engineering = true;\n',
      'maintenance.ts': '// @use-case docs/engineering/testing/use-case/maintain.md\nconst maintenance = true;\n',
      'explicit.ts': '// @feature docs/feature/cart/README.md\n// @native fixture:explicit\nconst noRange = true;\n',
      'parameters.ts': '// @feature docs/feature/cart/README.md\nconst parameters = true;\n',
    };
    mkdirSync(join(root, 'docs/engineering/testing/use-case'), { recursive: true });
    writeFileSync(join(root, 'docs/engineering/testing/use-case/maintain.md'), '# Maintain\n\nA repository maintenance path.\n');
    for (const [file, source] of Object.entries(sources)) writeFileSync(join(root, 'test', file), source);
    // This fixture is the external adapter protocol boundary. All collection,
    // cache persistence, source identity and marker binding use product code.
    writeFileSync(join(root, 'adapter.ts'), `import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let source = ''; for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
const item = (file, id, startLine, group) => ({ nativeId: 'fixture:' + id, file: 'test/' + file, project: 'default', kind: 'leaf', ...(startLine ? { range: { startLine, endLine: startLine, sourceDigest: 'sha256:' + createHash('sha256').update(readFileSync('test/' + file)).digest('hex') } } : {}), ...(group ? { group } : {}), selection: { opaqueId: id, capabilityVersion: 'v1' }, tags: {}, provenance: 'fixture' });
const payload = request.op === 'collect-plan'
 ? { invocations: [{ invocationId: 'collect', argv: [process.execPath, '-e', 'void 0'], cwd: '.', envNames: [], reports: [] }], planContext: {} }
 : { cases: [item('mixed.ts', 'linked', 2), item('mixed.ts', 'unlinked', 4), item('bare.ts', 'bare', 1), item('retired.ts', 'retired', 3), item('engineering.ts', 'engineering', 2), item('maintenance.ts', 'maintenance', 2), item('explicit.ts', 'explicit'), item('parameters.ts', 'parameter-a', 2, 'parameter'), item('parameters.ts', 'parameter-b', 2, 'parameter'), { ...item('bare.ts', 'suite', 1), kind: 'suite' }], capabilities: { realCollection: true, leaf: true, parameterGroups: true, exactSelection: true, perItemReport: true, range: true, rangeTrivia: false, tags: false, skipVisibility: true }, completeness: { complete: true, gaps: [] } };
process.stdout.write(JSON.stringify({ format: 'concord.test-adapter/v1', op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }));
`);
    writeProjectConfig(root, { ...readProjectConfig(root), testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: [], envNames: [] }] });
    assert.equal(Object.hasOwn(gaps(), 'unlinkedTests'), false);
    const repo = new LocalRepository(root);
    try { await runApplication(collectNativeTests(repo)); } finally { repo.close(); }
    const fresh = gaps();
    assert.equal(fresh.unlinkedTests?.stale, false);
    assert(Number.isFinite(Date.parse(fresh.unlinkedTests!.collectedAt)));
    assert.deepEqual(fresh.unlinkedTests?.tests, [
      { path: 'test/bare.ts', nativeId: 'fixture:bare', line: 1 },
      { path: 'test/mixed.ts', nativeId: 'fixture:unlinked', line: 4 },
    ]);
    writeFileSync(join(root, 'test/mixed.ts'), readFileSync(join(root, 'test/mixed.ts'), 'utf8') + '// changed\n');
    const stale = gaps();
    assert.equal(stale.unlinkedTests?.stale, true);
    assert.equal(stale.unlinkedTests?.collectedAt, fresh.unlinkedTests?.collectedAt);
    assert.deepEqual(stale.unlinkedTests?.tests, [{ path: 'test/bare.ts', nativeId: 'fixture:bare', line: 1 }]);
    assert(stale.limitations.some(value => value.includes('stale') && value.includes('test discover')));
    // Remove the marker from a current file: its old inventory remains visible.
    writeFileSync(join(root, 'test/explicit.ts'), 'const noRange = true;\n');
    assert(gaps().unlinkedTests?.tests.some(item => item.path === 'test/explicit.ts' && item.line === undefined && item.nativeId === 'fixture:explicit'));
    writeProjectConfig(root, { ...readProjectConfig(root), testAdapters: [{ id: 'node', include: ['test'], builtin: 'node-test', implementationFiles: [], inputRoots: [], frameworkVersion: process.versions.node, lockFiles: [], envNames: [] }] });
    const unsupported = new LocalRepository(root);
    try { await runApplication(collectNativeTests(unsupported)); } finally { unsupported.close(); }
    assert.equal(Object.hasOwn(gaps(), 'unlinkedTests'), false);
    assert(gaps().limitations.some(value => value.includes('did not collect a real')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
