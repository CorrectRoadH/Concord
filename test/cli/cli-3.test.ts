import { assert, existsSync, join, test, before, Effect, Schema, digest, Ack, ErrorOutput, CheckOutput, call, readPage, savePage, consumer, write } from '../support/cli-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#link-declarations
// @name packed-steps-navigation-and-maintenance
test('packed step commands route, return JSON and expose invalid relation exits', async () => {
 const root = consumer('steps-boundary');
 (await call(root, ['new', 'feature', 'journey', '--title', 'Journey'], Ack));
 (await call(root, ['new', 'use-case', 'flow', '--title', 'Flow', '--feature', 'journey'], Ack));
 const path = 'docs/feature/journey/use-case/flow.md';
 const before = readPage(root, path);
 (await savePage(root, path, '# Flow\n\n1. Step {#first}\n', before.digest));
 const steps = Schema.Struct({ steps: Schema.Array(Schema.Struct({ id: Schema.String })) });
 assert.deepEqual((await call(root, ['use-case', 'steps', path], steps)).steps.map(step => step.id), ['first']);
 (await call(root, ['use-case', 'format', path], Ack));
 const renamed = (await call(root, ['use-case', 'rename-step', path, 'first', 'second'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) })));
 assert.deepEqual(renamed.changedPaths, [path]);
 write(root, 'test/broken.ts', `// @use-case ${path}#missing\n`);
 const broken = (await call(root, ['check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ code: Schema.String })) }), '', 1));
 assert.equal(broken.ok, false);
 assert.ok(broken.findings.some(finding => finding.code === 'AnchorNotFound'));
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('installed Roadmap retains selected pages and Memory supports Engineering', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('document-packages');
 (await call(root, ['new', 'engineering', 'release', '--title', 'Release'], Ack));
 (await call(root, ['new', 'roadmap', 'session', '--title', 'Session', '--pages', 'architecture'], Ack));
 const started = (await call(root, ['roadmap', 'start', 'session'], Schema.Struct({ operation: Schema.Literal('roadmap-start') })));
 assert.equal(started.operation, 'roadmap-start');
 assert.equal(existsSync(join(root, 'docs/feature/session/architecture.md')), true);
 assert.equal((await call(root, ['show', 'session'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }))).document.path, 'docs/feature/session/README.md');
 (await call(root, ['new', 'memory', 'release-owner', '--title', 'Release owner'], Ack));
 (await call(root, ['memory', 'link', 'release-owner', 'docs/engineering/release/README.md'], Ack));
 assert.equal((await call(root, ['test', 'marker', '--contract', 'docs/engineering/release/README.md'], ErrorOutput, '', 1)).error, 'InvalidReferenceTarget');
 assert.equal((await call(root, ['check'], CheckOutput)).ok, true);
})));
