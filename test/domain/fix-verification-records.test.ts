import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkSince } from '../../src/app/index.js';
import { readDocumentSelector } from '../../src/domain/documents/index.js';
import { closeFixedIssue, replayFix } from '../../src/domain/tests/index.js';
import { renderDocument } from '../../src/model/index.js';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { readProjectConfig, writeProjectConfig } from '../support/support.js';

async function close(root: string, defect: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { return await runApplication(closeFixedIssue(repo, 'sku', 'Accumulate quantity', defect)); }
  finally { repo.close(); }
}
function record(root: string) {
  const repo = new LocalRepository(root);
  try {
    const document = readDocumentSelector(repo, 'sku', 'issue');
    const metadata = document.metadata;
    if (metadata.kind !== 'issue' || metadata.closure?.kind !== 'fixed' || !metadata.closure.verification) assert.fail('Expected verified fixed Issue');
    return { metadata, body: document.body, verification: metadata.closure.verification };
  } finally { repo.close(); }
}

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('replay checks recorded D and F despite later sourceFiles, tests, Spec and runner configuration edits', async () => {
  const f = createFixConsumer({ runnerSource: true });
  const log = `${f.root}-runtime-prepare.log`;
  try {
    const fix = f.fix();
    await close(f.root, f.defect);
    gitCommit(f.root, 'record verification');
    writeFileSync(join(f.root, 'runner.ts'), '// Later shared runner facility\n');
    writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = -1;\n');
    const testPath = join(f.root, 'test/cart.test.ts');
    writeFileSync(testPath, readFileSync(testPath, 'utf8') + '\nprocess.exitCode = 27;\n');
    const spec = join(f.root, 'docs/feature/cart/README.md');
    writeFileSync(spec, readFileSync(spec, 'utf8') + '\nAdditional behavior.\n');
    const config = readProjectConfig(f.root);
    writeProjectConfig(f.root, { ...config, runner: { ...config.runner!, timeoutMs: 5001, prepare: [[process.execPath, '-e', `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.cwd() + '\\n');`]] } });
    gitCommit(f.root, 'later project changes');
    const issue = join(f.root, 'docs/issues/sku.md');
    const before = readFileSync(issue, 'utf8');
    const checked = await runApplication(checkSince(f.root, f.defect));
    assert.equal(checked.ok, true, JSON.stringify(checked.findings));
    assert.equal(checked.verifications[0]?.verified, 'replayed');
    assert.equal(record(f.root).verification.fix, fix);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2, 'check --since prepares both recorded checkouts with runtime HEAD policy');
    const repo = new LocalRepository(f.root, { optimistic: true });
    try { assert.equal((await runApplication(replayFix(repo, 'sku'))).verified, 'replayed'); }
    finally { repo.close(); }
    const roots = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(roots.length, 4, 'test verify uses the same runtime HEAD policy');
    assert.ok(roots.every(root => root !== f.root));
    assert.equal(readFileSync(issue, 'utf8'), before);
    assert.equal(readFileSync(join(f.root, 'src/cart.ts'), 'utf8'), 'export const quantity = -1;\n');
  } finally { rmSync(f.root, { recursive: true, force: true }); rmSync(log, { force: true }); }
});

// @feature docs/feature/local-sdlc/cli.md#检查本次变化
test('handwritten false verification records still produce findings and never report replayed', async t => {
  const f = createFixConsumer();
  try {
    const fix = f.fix();
    await close(f.root, f.defect);
    const saved = record(f.root);
    gitCommit(f.root, 'record verification');
    writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = 3;\n');
    const broken = gitCommit(f.root, 'later regression');
    const path = join(f.root, 'docs/issues/sku.md');
    for (const [name, change, expected] of [
      ['passing defect', { defect: fix }, 'FixUnverifiable'],
      ['failing fix', { fix: broken }, 'FixVerificationFailed'],
      ['unavailable commit', { fix: '0'.repeat(40) }, 'FixUnverifiable'],
      ['forged configuration digest', { runner: `sha256:${'0'.repeat(64)}` }, 'FixUnverifiable'],
    ] as const) await t.test(name, async () => {
      const source = renderDocument({ ...saved.metadata, closure: { kind: 'fixed', reason: 'Handwritten claim', verification: { ...saved.verification, ...change } } }, saved.body);
      writeFileSync(path, source);
      const checked = await runApplication(checkSince(f.root, f.defect));
      assert.equal(checked.ok, false);
      assert.ok(checked.findings.some(item => item.path === 'docs/issues/sku.md' && item.code === expected), JSON.stringify(checked.findings));
      assert.ok(checked.verifications.every(item => item.verified !== 'replayed'));
      assert.equal(readFileSync(path, 'utf8'), source);
    });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
