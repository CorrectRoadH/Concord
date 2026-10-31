import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, authorDesignFixture, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, DecisionOutput, MemoryLifecycleOutput, TemplatesOutput, scratch, cli, call, callString, clearDecision, readPage, savePage, consumer, write } from '../support/cli-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#link-declarations
// @name packed-steps-navigation-and-maintenance
test('packed steps C15 C16 C18 navigate exact steps, preserve examples and rename through one journal', () => Effect.runPromise(Effect.sync(() => {
 const root = join(scratch, 'steps'); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
 call(root, ['init', '--source-root', 'src'], Ack);
 call(root, ['new', 'feature', 'journey', '--title', 'Journey'], Ack);
 call(root, ['new', 'use-case', 'flow', '--title', 'Flow', '--feature', 'journey'], Ack);
 const path = 'docs/feature/journey/use-case/flow.md';
 const owner = call(root, ['show', path], Schema.Struct({ document: DigestOutput }));
 savePage(root, path, '# Flow\n\n## Details\n\n1. Reject {#reject-token}\n2. Report\n\n## Acceptance\n\n1. Leave unmarked\n', owner.document.digest);
 write(root, 'test/flow.ts', `// @use-case ${path}#reject-token\n// @name stable\n\n// @use-case ${path}#details\n\n// @use-case ${path}\n\n// pytest.mark.unrelated\nconst fake = '// @use-case ${path}#reject-token';\n`);
 write(root, 'src/flow.ts', `// @concord-file\n// @concord-implements ${path}#reject-token\nexport const flow = 1;\n`);
 write(root, 'docs/feature/journey/links.md', `[Flow](use-case/flow.md#reject-token)\n\n\`[Example](use-case/flow.md#reject-token)\`\n`);
 const steps = Schema.Struct({ steps: Schema.Array(Schema.Struct({ id: Schema.String, testCount: Schema.Int, codeCount: Schema.Int })), lists: Schema.Array(Schema.Struct({ ordinal: Schema.Int, marked: Schema.Int })) });
 const initial = call(root, ['use-case', 'steps', path], steps);
 assert.deepEqual(initial.steps, [{ id: 'reject-token', testCount: 1, codeCount: 1 }]);
 assert.equal(initial.lists[1]?.marked, 0);
 call(root, ['check'], CheckOutput);
 call(root, ['use-case', 'format', path], Ack);
 assert.deepEqual(call(root, ['use-case', 'steps', path], steps).steps.map(step => step.id), ['reject-token', 'step-1']);
 const result = call(root, ['use-case', 'rename-step', path, 'reject-token', '拒绝令牌'], Schema.Struct({ affectedCases: Schema.Array(Schema.Struct({ before: Schema.String, after: Schema.String, named: Schema.Boolean })) }));
 assert.equal(result.affectedCases[0]?.before, result.affectedCases[0]?.after);
 assert.match(readFileSync(join(root, 'docs/feature/journey/links.md'), 'utf8'), /\[Flow\]\(use-case\/flow.md#拒绝令牌\)/u);
 assert.match(readFileSync(join(root, 'docs/feature/journey/links.md'), 'utf8'), /`\[Example\]\(use-case\/flow.md#reject-token\)`/u);
 const trace = call(root, ['trace', 'show', path], Schema.Struct({ stepGroups: Schema.Array(Schema.Struct({ nonStepAnchors: Schema.Array(Schema.Struct({ ref: Schema.String })), wholeUseCase: Schema.Struct({ tests: Schema.Array(Schema.Unknown) }) })) }));
 assert.equal(trace.stepGroups[0]?.nonStepAnchors[0]?.ref, `${path}#details`);
 assert.equal(trace.stepGroups[0]?.wholeUseCase.tests.length, 1);
 assert.match(callString(root, ['review', 'render', path]), /Step: .*#拒绝令牌/u);
 call(root, ['check'], CheckOutput);
 write(root, 'test/broken.ts', `// @use-case ${path}#missing\n`);
 const broken = call(root, ['check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ code: Schema.String })) }), '', 1);
 assert.equal(broken.ok, false); assert.ok(broken.findings.some(finding => finding.code === 'AnchorNotFound'));
})));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('installed Design and Roadmap packages retain their pages and authoritative lifecycle metadata', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('document-packages');
 call(root, ['new', 'engineering', 'release', '--title', 'Release'], Ack);
 call(root, ['new', 'design', 'storage', '--title', 'Storage', '--alternative', 'sqlite', '--alternative', 'files', '--pages', 'architecture'], Ack);
 assert.match(readFileSync(join(root, 'docs/design/storage/plans/sqlite/architecture.md'), 'utf8'), /Storage/);
 assert.equal(existsSync(join(root, 'docs/design/storage/GOALS.md')), true);
 const candidate = readPage(root, 'docs/design/storage/plans/sqlite/README.md');
 savePage(root, 'docs/design/storage/plans/sqlite/README.md', '# SQLite\n\nA single local store.\n', candidate.digest);
 authorDesignFixture(root, 'storage', ['sqlite', 'files'], 'sqlite');
 clearDecision(root, 'storage');
 call(root, ['design', 'decide', 'storage', '--selected', 'sqlite', '--target', 'docs/engineering/release/README.md', '--reason', 'One deployment owner'], Ack);
 const decision = call(root, ['show', 'storage'], DecisionOutput).document.metadata.decision;
 assert.equal(decision.selected, 'sqlite');
 call(root, ['new', 'roadmap', 'session', '--title', 'Session', '--pages', 'architecture'], Ack);
 call(root, ['roadmap', 'adopt', 'session', '--feature', 'session'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/session/architecture.md')), true);
 assert.equal(call(root, ['show', 'session'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) })).document.path, 'docs/feature/session/README.md');
 call(root, ['new', 'memory', 'release-owner', '--type', 'decision', '--title', 'Release owner'], Ack);
 call(root, ['memory', 'activate', 'release-owner', '--reason', 'Adopt'], Ack);
 call(root, ['memory', 'link', 'release-owner', '--target', 'docs/engineering/release/README.md'], Ack);
 assert.equal(call(root, ['test', 'annotate', '--contract', 'docs/engineering/release/README.md'], ErrorOutput, '', 1).error, 'InvalidReferenceTarget');
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
})));
