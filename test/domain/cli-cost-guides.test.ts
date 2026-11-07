import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { Schema } from 'effect';
import { InitializationReceiptSchema } from '../../src/model/index.ts';
import { executeQuery, executeViewAction } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';

// Empty repositories are the input under test; an initialized template would hide guide selection.
const scratch = mkdtempSync(join(tmpdir(), 'concord-guide-matrix-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
function consumer(name: string): string {
  const root = join(scratch, name);
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  return root;
}

// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
test('init recommends a writing guide from tracked and unignored initial files, including dry-run', async () => {
  const scenarios = [
    { name: 'empty', files: {}, guide: 'docs-from-scratch' },
    { name: 'untracked-source', files: { 'src/main.ts': 'export const value = 1;\n' }, guide: 'docs-from-code' },
    { name: 'package', files: { 'package.json': '{}\n' }, tracked: ['package.json'], guide: 'docs-from-code' },
    { name: 'only-docs', files: { 'README.md': '# Project\n', 'LICENSE-MIT': 'MIT\n', 'AGENTS.md': 'Project rules\n', '.gitignore': 'ignored/\n', 'docs/README.md': '# Project\n', 'memory/notes.md': '# Notes\n', '.config/tool.ts': '' }, guide: 'docs-from-scratch' },
    { name: 'ignored', files: { '.gitignore': 'src/\npackage.json\n', 'src/main.ts': '', 'package.json': '{}\n' }, guide: 'docs-from-scratch' },
    { name: 'tracked-ignored', files: { '.gitignore': 'package.json\n', 'package.json': '{}\n' }, tracked: ['package.json'], guide: 'docs-from-code' },
    { name: 'nested-readme', files: { 'app/README.md': '# App\n' }, guide: 'docs-from-code' },
    { name: 'nested-dot', files: { 'app/.config': '' }, guide: 'docs-from-code' },
    { name: 'newline-path', files: { 'src/line\nbreak.ts': '' }, guide: 'docs-from-code' },
  ] as const;
  for (const scenario of scenarios) {
    const root = consumer(`guide-${scenario.name}`);
    for (const [path, source] of Object.entries(scenario.files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    if ('tracked' in scenario) execFileSync('git', ['-C', root, 'add', '--force', ...scenario.tracked]);
    const before = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z']);
    const preview = Schema.decodeUnknownSync(InitializationReceiptSchema, { onExcessProperty: 'error' })(await runApplication(executeViewAction(root, { action: 'init', dryRun: true })));
    assert.equal(preview.guide, scenario.guide, scenario.name);
    assert.equal(preview.dryRun, true);
    assert.deepEqual(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z']), before);
    assert.equal(existsSync(join(root, '.git/concord')), false);
    const receipt = Schema.decodeUnknownSync(InitializationReceiptSchema, { onExcessProperty: 'error' })(await runApplication(executeViewAction(root, { action: 'init' })));
    assert.equal(receipt.guide, preview.guide, scenario.name);
    assert.equal(receipt.dryRun, false);
  }
});


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
