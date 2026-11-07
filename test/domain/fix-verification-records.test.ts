import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { closeFixedIssue, verifyTest } from '../../src/domain/tests/index.ts';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#verify
test('explicit verification uses frozen D/F inputs and current preparation after Issue deletion', async () => {
  const f = (await createFixConsumer({ runnerSource: true }));
  const log = `${f.root}-runtime-prepare.log`;
  try {
    const fix = f.fix();
    const closer = (await LocalRepository.open(f.root, { optimistic: true }));
    const receipt = await runApplication(closeFixedIssue(closer, 'sku', 'Fix', f.defect)).finally(() => closer.close());
    assert.equal(existsSync(join(f.root, 'docs/issues/sku.md')), false);
    gitCommit(f.root, 'remove Issue');
    writeFileSync(join(f.root, 'runner.ts'), '// Later facility\n');
    writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = -1;\n');
    writeFileSync(join(f.root, 'test/cart.test.ts'), '// Later test layout\n');
    writeFileSync(join(f.root, 'docs/feature/cart/README.md'), '# Cart\n\nAdditional behavior.\n');
    const config = (await readProjectConfig(f.root));
    writeProjectConfig(f.root, { ...config, runner: { ...config.runner!, timeoutMs: 5001, prepare: [[process.execPath, '-e', `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.cwd() + '\\n');`]] } });
    gitCommit(f.root, 'later changes');
    const repo = (await LocalRepository.open(f.root, { optimistic: true }));
    try {
      const replay = await runApplication(verifyTest(repo, receipt.verification.tests[0]!, f.defect, fix));
      assert.equal(replay.verified, 'replayed');
      assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
      assert.equal(existsSync(join(f.root, 'docs/issues/sku.md')), false);
      assert.equal(readFileSync(join(f.root, 'src/cart.ts'), 'utf8'), 'export const quantity = -1;\n');
    } finally { repo.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); rmSync(log, { force: true }); }
});
