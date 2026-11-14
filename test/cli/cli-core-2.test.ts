import { assert, existsSync, join, readFileSync, test, runCli, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('packed CLI rejects Research category and the removed open filter', async () => {
 const root = (await consumer('removed-document-options'));
 for (const args of [['new', 'research', 'notes'], ['list', 'research'], ['list', '--open']]) {
  const result = await runCli({argv:['--root',root,'--json',...args],cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(20000)});
  assert.equal(result.exitCode, 1, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  assert.match(result.stderr, /InvalidInput/u);
 }
 assert.equal(existsSync(join(root, 'docs/research/notes/README.md')), false);
});

// @feature docs/feature/local-sdlc/cli.md#测试关联与-issue-关闭
test('CLI rejects retired test execution and verification options before writing', async () => {
 const root = await consumer('removed-test-execution-options');
 const issuePath = 'docs/issues/retired.md';
 const issue = '# Pending issue\n';
 write(root, issuePath, issue);
 const config = readFileSync(join(root, 'concord.config.ts'), 'utf8');
 for (const args of [
  ['test', 'run', 'case'], ['test', 'verify', '--staged'],
  ['init', '--runner-config', 'runner.json'],
  ['issue', 'close', 'retired', '--fixed'],
  ['issue', 'close', 'retired', '--defect', 'HEAD~1'],
  ['issue', 'close', 'retired', '--fix', 'HEAD'],
 ]) {
  const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: root, env: process.env });
  assert.equal(result.exitCode, 1, JSON.stringify({ args, ...result }));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /InvalidInput/u);
  assert.equal(readFileSync(join(root, issuePath), 'utf8'), issue);
  assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), config);
 }
});
