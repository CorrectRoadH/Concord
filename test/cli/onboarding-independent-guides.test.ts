import { assert, writeFileSync, join, test, consumer } from './onboarding-independent-fixture.ts';
import { runCli } from '../support/cli.ts';


// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
test('human init ends with the recommended command and a refused init emits no guide', async () => {
  for (const code of [false, true]) {
    const root = consumer(code ? 'human-code' : 'human-scratch');
    if (code) writeFileSync(join(root, 'package.json'), '{}\n');
    const guide = code ? 'docs-from-code' : 'docs-from-scratch';
    const expected = ['Start here: docs/concord.md', `Writing guide: concord --skill ${guide}`, 'Inspect configuration: concord doctor'];
    for (const args of [['--dry-run', 'init'], ['init']]) {
      const reply = await runCli({ argv: ['--root', root, ...args], cwd: process.cwd(), env: process.env });
      assert.equal(reply.exitCode, 0, reply.stderr);
      assert.deepEqual(reply.stdout.trimEnd().split('\n').slice(-3), expected);
      assert.doesNotMatch(reply.stdout, /Next: concord new feature/u);
    }
    const refused = await runCli({ argv: ['--root', root, 'init'], cwd: process.cwd(), env: process.env });
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /InitializationConflict/u);
    assert.equal(refused.stdout, '');
    assert.doesNotMatch(refused.stderr, /Writing guide|docs-from-(?:scratch|code)/u);
  }
});
