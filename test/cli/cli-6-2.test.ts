import { assert, execFileSync, mkdirSync, readFileSync, existsSync, join, test, Effect, readProjectConfig, Ack, ErrorOutput, CheckOutput, DoctorOutput, DryRunOutput, scratch, call, consumer, write } from '../support/cli-fixture.ts';


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
 assert.deepEqual(config.testRoots, ['spec']); assert.deepEqual(config.runner, runner);
 assert.equal(readFileSync(join(root, 'docs/README.md'), 'utf8'), '# Existing documentation\n');
 assert.equal(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), '# Existing concepts\n');
 assert.equal(readFileSync(join(root, 'docs/architecture.md'), 'utf8'), '# Existing architecture\n');
 const diagnosis = (await call(root, ['doctor'], DoctorOutput));
 assert.deepEqual(diagnosis.missingTestRoots, ['spec']);
 (await call(root, ['check'], CheckOutput));
 assert.equal(existsSync(join(root, 'EXECUTED')), false);
 assert.equal((await call(root, ['init'], ErrorOutput, '', 1)).error, 'ProjectExists');
})));


// @feature docs/feature/taste/cli.md
test('packed boundaries reject non-current formats and preserve configuration, owners, receipts, journals and locks', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('current-formats-only');
 const taste = 'docs/taste.md';
 const current = readFileSync(join(root, taste), 'utf8');
 const invalidTaste = `---\nstatus: active\n---\n${current}`;
 write(root, taste, invalidTaste);
 assert.equal((await call(root, ['taste'], ErrorOutput, '', 1)).error, 'TasteEntryInvalid');
 assert.equal(readFileSync(join(root, taste), 'utf8'), invalidTaste);
 write(root, taste, current);
 const configPath = 'concord.config.ts';
 const config = readFileSync(join(root, configPath), 'utf8');
 for (const [source, code] of [['export default { projectId: \"retired\" };', 'InvalidData'], ['export default { ...{} };\n', 'InvalidConfigSyntax']] as const) {
  write(root, configPath, source);
  assert.equal((await call(root, ['config', 'show'], ErrorOutput, '', 1)).error, code);
  assert.equal(readFileSync(join(root, configPath), 'utf8'), source);
 }
 write(root, configPath, config);
 for (const format of ['concord.writing/v1', 'concord.writing/v2']) {
  const source = JSON.stringify({ format, bannedTerms: [] });
  write(root, 'docs/writing.md', source);
  assert.equal((await call(root, ['docs', 'check'], ErrorOutput, '', 1)).error, 'InvalidWritingPolicy');
  assert.equal(readFileSync(join(root, 'docs/writing.md'), 'utf8'), source);
 }
 const id = 'ccev_11111111111111111111111111111111';
 const receiptPath = `.git/concord/evidence/${id}.json`;
 const receipt = JSON.stringify({ format: 'concord.command-evidence/v1', id });
 write(root, receiptPath, receipt);
 (await call(root, ['config', 'show'], Ack));
 assert.equal(readFileSync(join(root, receiptPath), 'utf8'), receipt);
 const journalPath = '.git/concord/journal.json', lockPath = '.git/concord/lock.json';
 const journal = JSON.stringify({ format: 'concord.journal', scope: { kind: 'documents' } });
 const lock = 'preserve invalid lock bytes';
 write(root, journalPath, journal); write(root, lockPath, lock);
 for (const command of ['check', 'recover']) {
  assert.equal((await call(root, [command], ErrorOutput, '', 1)).error, 'InvalidData');
  assert.equal(readFileSync(join(root, journalPath), 'utf8'), journal);
  assert.equal(readFileSync(join(root, lockPath), 'utf8'), lock);
 }
})));
