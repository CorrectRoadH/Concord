import { assert, execFileSync, existsSync, mkdirSync, readFileSync, join, test, Effect, run, consumer } from './onboarding-independent-fixture.ts';
import { runCli } from '../support/cli.ts';


// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('installed CLI exposes exactly the current command inventory and rejects retired helpers', () => Effect.runPromise(Effect.promise(async () => {
  const root = consumer('commands');
  const result = await runCli({ argv: ['--help'], cwd: root, env: process.env });
  assert.equal(result.exitCode, 0, result.stderr);
  const commands = result.stdout.split('SUBCOMMANDS')[1]!.trim().split('\n').map(line => line.trim().split(/\s+/u)[0]).filter(Boolean);
  assert.deepEqual(commands.sort(), ['schema','init','skills','new','show','list','move','check','trace','test','code','use-case','issue','memory','roadmap','taste','concepts','writing','docs','feedback','view','server','herdr','config','template','cache','recover','doctor','lsp','review','action','workspace','git'].sort());
  for (const group of ['memory', 'issue', 'use-case', 'roadmap']) {
    const help = await runCli({ argv: [group, '--help'], cwd: root, env: process.env });
    assert.equal(help.exitCode, 0, help.stderr);
    assert.doesNotMatch(help.stdout, /\n  (?:create|add|page|promote|retire|correct-reason|resolve|metadata)\s/u);
  }
  await run(root, ['init']);
  execFileSync('git', ['-C', root, 'add', '--all']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Concord fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Initialize fixture']);
  assert.equal((await run(root, ['workspace', 'show'])).root, root);
  assert.deepEqual((await run(root, ['git', 'status'])).entries, []);
})));


// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#init
test('installed init previews without writing configuration and creates direct-edit guidance', () => Effect.runPromise(Effect.promise(async () => {
  const root = consumer('init');
  await run(root, ['--dry-run', 'init']);
  assert.equal(existsSync(join(root, 'docs')), false);
  assert.equal(existsSync(join(root, '.git/concord')), false);
  await run(root, ['init']);
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /Directly edit files[\s\S]*check/u);
  const nested = join(root, 'nested'); mkdirSync(nested);
  const result = await runCli({ argv: ['--json', 'new', 'feature', 'cart', '--pages', 'cli,use-case'], cwd: nested, env: process.env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).changedPaths, ['docs/feature/cart/README.md', 'docs/feature/cart/cli.md', 'docs/feature/cart/use-case/README.md']);
  assert.equal((await run(root, ['list', 'feature'])).documents[0].path, 'docs/feature/cart/README.md');
  assert.equal((await run(root, ['show', 'cart'])).document.metadata.title, 'cart');
})));
