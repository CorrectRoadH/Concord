import { assert, execFileSync, mkdirSync, existsSync, join, test, Effect, readProjectConfig, Ack, ErrorOutput, DryRunOutput, scratch, call, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed init previews configuration, preserves existing docs, and never runs the configured command', () => Effect.runPromise(Effect.promise(async () => {
 const root = join(scratch, 'init-options'); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
 write(root, 'docs/README.md', '# Existing documentation\n');
 write(root, 'docs/concepts.md', '# Existing concepts\n');
 write(root, 'docs/architecture.md', '# Existing architecture\n');
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 const runner = { kind: 'command', argv: ['node', '-e', 'require("node:fs").writeFileSync("EXECUTED", "bad")'], sourceFiles: [], timeoutMs: 1200 };
 write(root, 'runner.json', JSON.stringify(runner));
 const args = ['init', '--test-root', 'spec', '--runner-config', join(root, 'runner.json')];
 assert.equal((await call(root, ['--dry-run', ...args], DryRunOutput)).dryRun, true);
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 assert.equal(existsSync(join(root, '.git/concord')), false);
 (await call(root, args, Ack));
 const config = readProjectConfig(root);
 assert.deepEqual(config.testRoots, ['spec']);
 assert.deepEqual(config.runner, runner);
 assert.equal((await call(root, ['init'], ErrorOutput, '', 1)).error, 'ProjectExists');
})));


// @feature docs/feature/taste/cli.md
test('current-format query commands map named errors without rewriting inputs', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('format-error-mapping');
 write(root, 'docs/taste.md', '---\nstatus: active\n---\n# Taste\n');
 assert.equal((await call(root, ['taste'], ErrorOutput, '', 1)).error, 'TasteEntryInvalid');
})));
