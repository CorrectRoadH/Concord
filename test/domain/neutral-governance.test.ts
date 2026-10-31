import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkCurrentProject, checkSince, traceShow } from '../../src/app/index.js';
import { createConsumer } from '../support/consumer.js';
import { gitCommit } from '../support/fix-consumer.js';
import { createDocument } from '../support/operations.js';
import { renderOwnerFixture } from '../support/owner-fixture.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { writeProjectConfig } from '../support/support.js';

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('neutral static checks and trace derive source relations without executing the configured runner', async () => {
  const root = createConsumer();
  try {
    const writer = new LocalRepository(root);
    try { createDocument(writer, 'feature', { id: 'cart', title: 'Cart' }); } finally { writer.close(); }
    writeProjectConfig(root, { testRoots: ['spec'], sourceRoots: ['lib'], runner: {
      kind: 'command', argv: ['node', '-e', 'require("node:fs").writeFileSync("EXECUTED", "bad")'], sourceFiles: [], timeoutMs: 1000,
    } });
    mkdirSync(join(root, 'spec')); mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'spec/cart.test.ts'), '// @feature docs/feature/cart/README.md\n');
    writeFileSync(join(root, 'lib/cart.ts'), '// @concord-file\n// @concord-implements docs/feature/cart/README.md\nexport const quantity = 1;\n');
    const repo = new LocalRepository(root);
    try {
      const trace = traceShow(repo, 'cart', 'off');
      assert.equal(trace.tests.length, 1);
      assert.deepEqual(trace.codeDeclarations.map(item => item.file), ['lib/cart.ts']);
      assert.equal('commandOutcome' in trace.tests[0]!, false, 'a declaration does not acquire an execution verdict');
    } finally { repo.close(); }
    const checked = await runApplication(checkCurrentProject(root, 'off'));
    assert.equal(checked.ok, true, JSON.stringify(checked.findings));
    assert.equal(existsSync(join(root, 'EXECUTED')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('removing runner configuration cannot authorize a directly written fixed closure without verification', async () => {
  const root = createConsumer();
  try {
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'issue', { id: 'unverified', title: 'Unverified closure' }); } finally { repo.close(); }
    writeProjectConfig(root, { runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 1000 } });
    const base = gitCommit(root, 'open observation');
    // Invalid closure fixture: verification is deliberately absent.
    const source = renderOwnerFixture({ kind: 'issue', id: 'unverified', title: 'Unverified closure', status: 'closed', relations: [], closure: { kind: 'fixed', reason: 'Claimed fix' } });
    const path = join(root, 'docs/issues/unverified.md');
    writeFileSync(path, source);
    rmSync(join(root, 'concord.config.ts'));
    const checked = await runApplication(checkSince(root, base));
    assert.equal(checked.ok, false);
    assert.ok(checked.findings.some(item => item.path === 'docs/issues/unverified.md' && item.code === 'FixUnverifiable'), JSON.stringify(checked.findings));
    assert.equal(readFileSync(path, 'utf8'), source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
