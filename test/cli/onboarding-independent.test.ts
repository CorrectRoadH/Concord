import { packageBin } from '../../scripts/package-location.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect } from 'effect';
import { packConcord, installConcord } from '../support/installed-package.js';

const scratch = mkdtempSync(join(tmpdir(), 'concord-public-onboarding-'));
let cli: string;
before(() => Effect.runPromise(Effect.sync(() => {
  const install = join(scratch, 'tool'); mkdirSync(install);
  writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  installConcord(install, packConcord(scratch));
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
  assert.deepEqual(commands.sort(), ['init','new','show','list','check','trace','test','code','use-case','issue','memory','design','roadmap','constitution','concepts','writing','docs','feedback','view','panel','server','config','template','cache','recover','doctor','lsp','review','action','workspace','git'].sort());
  for (const group of ['memory', 'issue', 'design', 'use-case', 'roadmap']) {
    const help = spawnSync(process.execPath, [cli, group, '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.doesNotMatch(help.stdout, /\n  (?:create|add|page|promote|retire|correct-reason|resolve|metadata)\s/u);
  }
  assert.equal(run(root, ['workspace', 'show']).root, root);
  assert.deepEqual(run(root, ['git', 'status']).entries, []);
})));

// @use-case docs/feature/project-onboarding/use-case/initialize-project.md
test('installed init previews without writing configuration and creates direct-edit guidance', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('init');
  run(root, ['--dry-run', 'init']);
  assert.equal(existsSync(join(root, 'docs')), false);
  assert.equal(existsSync(join(root, '.git/concord')), false);
  run(root, ['init']);
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /Directly edit files[\s\S]*check --since <base>/u);
  const nested = join(root, 'nested'); mkdirSync(nested);
  const result = spawnSync(process.execPath, [cli, '--json', 'new', 'feature', 'cart', '--pages', 'cli,use-case'], { cwd: nested, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).changedPaths, ['docs/feature/cart/README.md', 'docs/feature/cart/cli.md', 'docs/feature/cart/use-case/README.md']);
  assert.equal(run(root, ['list', 'feature']).documents[0].path, 'docs/feature/cart/README.md');
  assert.equal(run(root, ['show', 'cart']).document.metadata.title, 'cart');
})));

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
  run(root, ['new', 'memory', 'choice', '--type', 'decision']);
  run(root, ['memory', 'activate', 'choice', '--reason', 'Adopt']);
  run(root, ['memory', 'link', 'choice', '--target', 'docs/feature/cart/README.md', '--role', 'supports']);
  run(root, ['new', 'issue', 'bug']);
  run(root, ['issue', 'link', 'bug', 'memory/choice.md', '--role', 'investigation']);
  run(root, ['issue', 'unlink', 'bug', 'memory/choice.md', '--role', 'investigation']);
  run(root, ['issue', 'link', 'bug', 'docs/feature/cart/README.md', '--role', 'adopts']);
  run(root, ['issue', 'unlink', 'bug', 'docs/feature/cart/README.md', '--role', 'adopts']);
  assert.match(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /type: decision[\s\S]*status: current[\s\S]*role: supports/u);
  assert.doesNotMatch(readFileSync(join(root, 'docs/issues/bug.md'), 'utf8'), /relations:|history:|format:|draft/u);
  assert.equal(run(root, ['list', 'issue']).documents.length, 1);
})));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('installed new Design creates candidate scaffolds and defer records its reason', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('design');
  run(root, ['new', 'design', 'storage']);
  for (const plan of ['plan-1', 'plan-2']) assert.equal(existsSync(join(root, `docs/design/storage/plans/${plan}/README.md`)), true);
  run(root, ['design', 'defer', 'storage', '--reason', 'Wait for measurements']);
  assert.match(readFileSync(join(root, 'docs/design/storage/DECISION.md'), 'utf8'), /Deferred: Wait for measurements/u);
})));
