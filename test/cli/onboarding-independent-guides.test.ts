import { sourceCli, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, tmpdir, stopWorkspaceServer, join, test, before, after, Effect, Schema, InitializationReceiptSchema, scratch, consumers, cli, run, consumer, action } from './onboarding-independent-fixture.ts';


// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
test('init recommends a writing guide from tracked and unignored initial files, including dry-run', () => {
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
    const preview = Schema.decodeUnknownSync(InitializationReceiptSchema, { onExcessProperty: 'error' })(run(root, ['--dry-run', 'init']));
    assert.equal(preview.guide, scenario.guide, scenario.name);
    assert.equal(preview.dryRun, true);
    assert.deepEqual(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z']), before);
    assert.equal(existsSync(join(root, '.git/concord')), false);
    const receipt = Schema.decodeUnknownSync(InitializationReceiptSchema, { onExcessProperty: 'error' })(run(root, ['init']));
    assert.equal(receipt.guide, preview.guide, scenario.name);
    assert.equal(receipt.dryRun, false);
  }
});


// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
test('human init ends with the recommended command and a refused init emits no guide', () => {
  for (const code of [false, true]) {
    const root = consumer(code ? 'human-code' : 'human-scratch');
    if (code) writeFileSync(join(root, 'package.json'), '{}\n');
    const guide = code ? 'docs-from-code' : 'docs-from-scratch';
    const expected = ['Start here: docs/concord.md', `Writing guide: concord --skill ${guide}`, 'Inspect configuration: concord doctor'];
    for (const args of [['--dry-run', 'init'], ['init']]) {
      const reply = spawnSync(process.execPath, [cli, '--root', root, ...args], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(reply.status, 0, reply.stderr);
      assert.deepEqual(reply.stdout.trimEnd().split('\n').slice(-3), expected);
      assert.doesNotMatch(reply.stdout, /Next: concord new feature/u);
    }
    const refused = spawnSync(process.execPath, [cli, '--root', root, 'init'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /InitializationConflict/u);
    assert.equal(refused.stdout, '');
    assert.doesNotMatch(refused.stderr, /Writing guide|docs-from-(?:scratch|code)/u);
  }
});


// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#write
test('the initialized project accepts a directly written first Spec', () => {
  const root = consumer('first-spec');
  run(root, ['init']);
  mkdirSync(join(root, 'docs/feature/cart/use-case'), { recursive: true });
  writeFileSync(join(root, 'docs/feature/cart/README.md'), '# Cart\n\nShoppers collect their purchases.\n\nSee [add an item](use-case/add.md).\n');
  writeFileSync(join(root, 'docs/feature/cart/use-case/add.md'), '# Add an item\n\n## Journey\n\n1. Select an item. {#select}\n2. Add it to the cart. {#add}\n');
  assert.equal(run(root, ['check']).ok, true);
});
