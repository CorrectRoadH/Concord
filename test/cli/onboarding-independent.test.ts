import { sourceCli, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, tmpdir, stopWorkspaceServer, join, test, before, after, Effect, Schema, InitializationReceiptSchema, scratch, consumers, cli, run, consumer, action } from './onboarding-independent-fixture.ts';


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
  run(root, ['init']);
  execFileSync('git', ['-C', root, 'add', '--all']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Concord fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Initialize fixture']);
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
