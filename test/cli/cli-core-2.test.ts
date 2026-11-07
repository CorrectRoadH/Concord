import { assert, existsSync, join, test, runCli, consumer } from '../support/cli-fixture.ts';


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
