import { assert, readFileSync, existsSync, join, test, Effect, digest, caseDiscriminator, deriveTestReference, Ack, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, OwnerOutput, runCli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('installed onboarding creates editable packages and connects supporting-page tests to their Feature', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('onboarding');
 const guide = readFileSync(join(root, 'docs/concord.md'), 'utf8');
 assert.match(guide, /concord test list/);
 assert.match(guide, /a product direction in the same genre as Feature that has not been adopted yet\. Its design is incomplete, or it is designed but not scheduled/u);
 assert.match(guide, /Behavior pages \(Feature README, Use Case, cli, library\) state commands, real human and JSON output, exit codes, and named errors\./u);
 assert.match(guide, /The architecture page states how the Feature is implemented\. Run `concord --skill document` for the full rules\./u);
 for (const path of ['docs/README.md', 'docs/_template/roadmap/use-case/README.md', 'docs/_template/design/README.md', 'docs/_template/engineering/README.md', 'docs/concepts.md', 'docs/architecture.md', 'docs/_template/memory/README.md']) assert.equal(existsSync(join(root, path)), true, path);
 assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /BEGIN CONCORD AGENT INSTRUCTIONS[\s\S]*concord trace gaps --json/u);
 (await call(root, ['new', 'feature', 'accounts', '--title', 'Accounts', '--pages', 'library,cli,architecture,use-case'], Ack));
 for (const page of ['README.md', 'library.md', 'cli.md', 'architecture.md', 'use-case/README.md']) assert.equal(existsSync(join(root, 'docs/feature/accounts', page)), true, page);
 (await call(root, ['new', 'feature', 'other', '--title', 'Other'], Ack));
 (await call(root, ['new', 'engineering', 'ci', '--title', 'Continuous integration'], Ack));
 const page = readPage(root, 'docs/feature/accounts/cli.md');
 (await savePage(root, 'docs/feature/accounts/cli.md', '# Accounts CLI\n\n## Sign in\n\nReject expired tokens.\n', page.digest));
 assert.equal((await savePage(root, 'docs/feature/accounts/cli.md', '# Stale\n', page.digest, 1)).error, 'FileChangedSinceRead');
 const ownerBefore = (await call(root, ['show', 'accounts'], OwnerOutput)).document;
 const readme = readPage(root, 'docs/feature/accounts/README.md');
 assert.ok(!readme.body.startsWith('---'));
 (await savePage(root, 'docs/feature/accounts/README.md', '# Accounts\n\nUsers sign in with valid credentials.\n', readme.digest));
 assert.deepEqual((await call(root, ['show', 'accounts'], OwnerOutput)).document.metadata, ownerBefore.metadata);
 (await call(root, ['new', 'issue', 'expired', '--title', 'Expired token'], Ack));
 const annotation = (await call(root, ['test', 'marker', '--contract', 'docs/feature/accounts/cli.md#sign-in', '--issue', 'docs/issues/expired.md'], AnnotationOutput));
 assert.equal(existsSync(join(root, 'test')), false, 'annotate must not edit test sources');
 write(root, 'test/accounts.test.mjs', `import test from 'node:test';\n${annotation.snippet}test('rejects expired tokens', () => {});\n`);
 const accountCase = deriveTestReference('test/accounts.test.mjs', 'test/accounts.test.mjs', caseDiscriminator('docs/feature/accounts/cli.md#sign-in', 0));
 assert.equal((await call(root, ['check'], CheckOutput)).ok, true);
 const tracedTest = (await call(root, ['trace', 'show', 'accounts'], TraceOutput)).tests[0];
 assert.ok(tracedTest);
 assert.equal(tracedTest.id, accountCase);
 assert.equal((await call(root, ['trace', 'show', 'other'], TraceOutput)).tests.length, 0);
 assert.match((await callString(root, ['review', 'accounts'])), new RegExp(accountCase));
 assert.equal((await call(root, ['doctor'], DoctorOutput)).cases, 1);
 const human = await runCli({argv:['--root',root,'test','list'],cwd:process.cwd(),env:process.env});
 assert.equal(human.exitCode, 0, human.stderr);
 assert.match(human.stdout, new RegExp(accountCase));
 assert.match(human.stdout, /Contract:/);
 assert.ok(!human.stdout.trimStart().startsWith('{'));
})));
