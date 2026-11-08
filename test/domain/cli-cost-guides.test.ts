import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { Schema } from 'effect';
import { executeQuery, executeViewAction } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';

// Initialize the consumer through the same application action as the workbench.
const scratch = mkdtempSync(join(tmpdir(), 'concord-guide-matrix-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
function consumer(name: string): string {
  const root = join(scratch, name);
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  return root;
}

// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#write
test('the initialized project accepts a directly written first Spec', async () => {
  const root = consumer('first-spec');
  await runApplication(executeViewAction(root, { action: 'init' }));
  mkdirSync(join(root, 'docs/feature/cart/use-case'), { recursive: true });
  writeFileSync(join(root, 'docs/feature/cart/README.md'), '# Cart\n\nShoppers collect their purchases.\n\nSee [add an item](use-case/add.md).\n');
  writeFileSync(join(root, 'docs/feature/cart/use-case/add.md'), '# Add an item\n\n## Journey\n\n1. Select an item. {#select}\n2. Add it to the cart. {#add}\n');
  const checked = await runApplication(executeQuery(root, { name: 'check', input: {} }));
  assert.equal(checked.exitCode, 0);
  assert.equal(Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Boolean }))(checked.value).ok, true);
});
