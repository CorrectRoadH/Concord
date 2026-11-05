import { packageBin } from '../support/installed-package.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { InitializationReceiptSchema } from '../../src/model/index.js';
import { sourceConcord, prepareSourceConsumer } from '../support/installed-package.js';

const scratch = mkdtempSync(join(tmpdir(), 'concord-public-onboarding-'));
let cli: string;
before(() => Effect.runPromise(Effect.sync(() => {
  const install = join(scratch, 'tool'); mkdirSync(install);
  writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  prepareSourceConsumer(install, sourceConcord());
  cli = packageBin(join(install, 'node_modules/concord-sdlc'));
})));
after(() => Effect.runPromise(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));
function run(root: string, args: readonly string[], input = '', status = 0): any {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout || result.stderr);
}
function consumer(name: string): string {
  const root = join(scratch, name); mkdirSync(root); execFileSync('git', ['init', '-q', root]); return root;
}
const action = (root: string, input: unknown, status = 0): any => run(root, ['action', '--input', '-'], JSON.stringify(input), status);

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('installed CLI exposes exactly the current command inventory and rejects retired helpers', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('commands');
  const result = spawnSync(process.execPath, [cli, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const commands = result.stdout.split('SUBCOMMANDS')[1]!.trim().split('\n').map(line => line.trim().split(/\s+/u)[0]).filter(Boolean);
  assert.deepEqual(commands.sort(), ['init','skills','new','show','list','check','trace','test','code','use-case','issue','memory','roadmap','taste','concepts','writing','docs','feedback','view','server','herdr','config','template','cache','recover','doctor','lsp','review','action','workspace','git'].sort());
  for (const group of ['memory', 'issue', 'use-case', 'roadmap']) {
    const help = spawnSync(process.execPath, [cli, group, '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.doesNotMatch(help.stdout, /\n  (?:create|add|page|promote|retire|correct-reason|resolve|metadata)\s/u);
  }
  assert.equal(run(root, ['workspace', 'show']).root, root);
  assert.deepEqual(run(root, ['git', 'status']).entries, []);
})));

// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#init
test('installed init previews without writing configuration and creates direct-edit guidance', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('init');
  run(root, ['--dry-run', 'init']);
  assert.equal(existsSync(join(root, 'docs')), false);
  assert.equal(existsSync(join(root, '.git/concord')), false);
  run(root, ['init']);
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /Directly edit files[\s\S]*check/u);
  const nested = join(root, 'nested'); mkdirSync(nested);
  const result = spawnSync(process.execPath, [cli, '--json', 'new', 'feature', 'cart', '--pages', 'cli,use-case'], { cwd: nested, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).changedPaths, ['docs/feature/cart/README.md', 'docs/feature/cart/cli.md', 'docs/feature/cart/use-case/README.md']);
  assert.equal(run(root, ['list', 'feature']).documents[0].path, 'docs/feature/cart/README.md');
  assert.equal(run(root, ['show', 'cart']).document.metadata.title, 'cart');
})));

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

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('installed config.set creates optional configuration and rejects retired fields and stale digests', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('config');
  const current = run(root, ['config', 'show']);
  assert.deepEqual(current.config, {});
  action(root, { action: 'config.set', config: { testRoots: [] }, expectedDigest: current.digest });
  const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
  assert.doesNotMatch(source, /projectId|concord.project|memorySources/u);
  assert.equal(action(root, { action: 'config.set', config: {}, expectedDigest: current.digest }, 1).error, 'FileChangedSinceRead');
  const next = run(root, ['config', 'show']);
  assert.equal(action(root, { action: 'config.set', config: { projectId: 'legacy' }, expectedDigest: next.digest }, 1).error, 'InvalidData');
  assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
})));

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('installed new and relation helpers persist only current owner fields', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('owners');
  run(root, ['new', 'feature', 'cart']);
  run(root, ['new', 'use-case', 'add', '--feature', 'cart']);
  run(root, ['new', 'memory', 'choice']);
  run(root, ['memory', 'link', 'choice', 'docs/feature/cart/README.md']);
  run(root, ['new', 'issue', 'bug']);
  run(root, ['issue', 'link', 'bug', 'memory/choice.md', '--role', 'investigation']);
  run(root, ['issue', 'unlink', 'bug', 'memory/choice.md', '--role', 'investigation']);
  run(root, ['issue', 'link', 'bug', 'docs/feature/cart/README.md', '--role', 'adopts']);
  run(root, ['issue', 'unlink', 'bug', 'docs/feature/cart/README.md', '--role', 'adopts']);
  assert.match(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /role: supports/u);
  assert.doesNotMatch(readFileSync(join(root, 'docs/issues/bug.md'), 'utf8'), /relations:|history:|format:|draft/u);
  assert.equal(run(root, ['list', 'issue']).documents.length, 1);
})));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('installed new Design creates one directly editable tradeoff page', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('design');
  run(root, ['new', 'design', 'storage']);
  assert.equal(existsSync(join(root, 'docs/design/storage.md')), true);
  assert.equal(existsSync(join(root, 'docs/design/storage')), false);
})));
