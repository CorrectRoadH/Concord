import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, authorDesignFixture, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, DecisionOutput, MemoryLifecycleOutput, TemplatesOutput, scratch, cli, call, callString, clearDecision, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed diagnostic CLI refreshes after exit and marks cached output as historical', async () => {
 const root = consumer('async-query');
 call(root, ['new', 'feature', 'cached', '--title', 'Cached'], Ack);
 const query = () => spawnSync(process.execPath, [cli, '--root', root, '--json', 'trace', 'gaps'], { encoding: 'utf8', timeout: 20000 });
 const first = query();
 assert.equal(first.status, 1, first.stdout + first.stderr);
 assert.match(first.stderr, /QueryPending/);
 const result = await pollUntil(async () => {
  const result = query();
  if (result.status === 0) return result;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const error = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(result.stderr);
  assert.ok(['QueryPending', 'HawdbBusy'].includes(error.error), result.stderr);
  return undefined;
 }, { timeoutMs: 30000, description: 'packed diagnostic projection' });
 assert.equal(result.status, 0, result.stdout + result.stderr);
 const value = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ projection: Schema.Struct({ current: Schema.Literal(false), builtAt: Schema.String, refresh: Schema.String }) })))(result.stdout);
 assert.equal(value.projection.refresh, 'requested');
 assert.ok(Number.isFinite(Date.parse(value.projection.builtAt)));
});


// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('packed Design commands require complete responses and preserve formatting and decision semantics', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('design-comparison');
 call(root, ['new', 'design', 'storage', '--title', 'Storage', '--alternative', 'local', '--alternative', 'remote'], Ack);
 const base = join(root, 'docs/design/storage');
 assert.match(readFileSync(join(base, 'plans/local/README.md'), 'utf8'), /## Limits/u);
 const incomplete = call(root, ['design', 'check', 'storage'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String, code: Schema.String, message: Schema.String })) }), '', 1);
 assert.equal(incomplete.ok, false);
 assert(incomplete.findings.some(item => item.code === 'DesignSelectionInvalid'));
 assert.deepEqual(incomplete.findings.filter(item => item.code === 'DesignResponseIncomplete'), ['local', 'remote'].flatMap(plan => ['L1', 'G1'].flatMap(id => ['Mechanism or gap', 'Evidence'].map(column => ({
  path: `docs/design/storage/plans/${plan}/README.md`, code: 'DesignResponseIncomplete', message: `${id} requires authored ${column}`,
 })))));
 assert.equal(call(root, ['design', 'decide', 'storage', '--selected', 'local', '--reason', 'Local'], ErrorOutput, '', 1).error, 'DesignDecisionIncomplete');
 authorDesignFixture(root, 'storage', ['local', 'remote'], 'local');
 call(root, ['design', 'check', 'storage'], CheckOutput);
 const plan = join(base, 'plans/local/README.md');
 const source = readFileSync(plan, 'utf8').replace('## Limits', '##   Limits  ');
 writeFileSync(plan, source);
 call(root, ['--dry-run', 'design', 'format', 'storage'], DryRunOutput);
 assert.equal(readFileSync(plan, 'utf8'), source);
 call(root, ['design', 'format', 'storage'], Ack);
 assert.match(readFileSync(plan, 'utf8'), /\n## Limits\n/u);
 assert.deepEqual(call(root, ['design', 'format', 'storage'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) })).changedPaths, []);
 clearDecision(root, 'storage');
 const owner = readFileSync(join(base, 'README.md'), 'utf8');
 call(root, ['--dry-run', 'design', 'decide', 'storage', '--selected', 'local', '--reason', 'Offline'], DryRunOutput);
 assert.equal(readFileSync(join(base, 'README.md'), 'utf8'), owner);
 assert.equal(call(root, ['design', 'decide', 'storage', '--selected', 'remote', '--reason', 'Remote'], ErrorOutput, '', 1).error, 'DesignDecisionIncomplete');
 call(root, ['design', 'decide', 'storage', '--selected', 'local', '--reason', 'Offline'], Ack);
 assert.equal(call(root, ['show', 'storage'], DecisionOutput).document.metadata.decision.selected, 'local');
 call(root, ['design', 'check', 'storage'], CheckOutput);

})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed create selects optional pages, keeps README required, and rejects invalid selections before writing', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('optional-pages');
 const only = call(root, ['new', 'feature', 'minimal', '--title', 'Minimal'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(only.changedPaths, ['docs/feature/minimal/README.md']);
 assert.doesNotMatch(readFileSync(join(root, only.changedPaths[0]!), 'utf8'), /\]\(/);
 call(root, ['new', 'feature', 'selected', '--title', 'Selected', '--pages', 'cli,library', '--pages', 'use-case'], Ack);
 const base = 'docs/feature/selected/';
 const readme = readFileSync(join(root, base, 'README.md'), 'utf8');
 for (const match of readme.matchAll(/\]\(([^)]+)\)/g)) assert.equal(existsSync(join(root, base, match[1]!)), true);
 assert.equal(existsSync(join(root, base, 'architecture.md')), false);
 assert.equal(existsSync(join(root, base, 'lifecycle.md')), false);
 assert.equal(call(root, ['list', 'use-case'], Schema.Struct({ documents: Schema.Array(Schema.Unknown) })).documents.length, 0);
 assert.equal(readFileSync(join(root, base, 'README.md'), 'utf8'), readme);
 const author = '# Custom\n\nKeep [my link](custom.md).\n';
 call(root, ['new', 'feature', 'custom', '--title', 'Custom', '--body', '-', '--pages', 'cli'], Ack, author);
 const shown = call(root, ['show', 'custom'], Schema.Struct({
   document: Schema.Struct({ path: Schema.String, metadata: Schema.Unknown, digest: Schema.String }),
   useCases: Schema.Array(Schema.Unknown), tests: Schema.Array(Schema.Unknown), codeDeclarations: Schema.Array(Schema.Unknown), findings: Schema.Array(Schema.Unknown),
 }));
 assert.equal(shown.document.path, 'docs/feature/custom/README.md');
 assert.deepEqual(shown.useCases, []);
 assert.equal('body' in shown.document, false, 'feature show leaves author prose to direct file reads');
 call(root, ['new', 'use-case', 'custom-flow', '--title', 'Custom flow', '--feature', 'custom'], Ack);
 const featureRelations = call(root, ['show', 'custom'], Schema.Struct({ useCases: Schema.Array(Schema.Struct({ path: Schema.String })) }));
 assert.deepEqual(featureRelations.useCases.map(item => item.path), ['docs/feature/custom/use-case/custom-flow.md']);
 const useCaseRelations = call(root, ['show', 'custom-flow'], Schema.Struct({
   document: Schema.Struct({ path: Schema.String }), outgoing: Schema.Array(Schema.Struct({ to: Schema.String })),
 }));
 assert.equal(useCaseRelations.document.path, 'docs/feature/custom/use-case/custom-flow.md');
 assert.ok(useCaseRelations.outgoing.some(edge => edge.to === 'docs/feature/custom/README.md'));
 call(root, ['--dry-run', 'new', 'feature', 'preview', '--title', 'Preview', '--pages', 'cli'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/preview')), false);
 for (const [id, pages, error] of [['unknown', 'other', 'InvalidData'], ['duplicate', 'cli,cli', 'InvalidInput'], ['empty', 'cli,', 'InvalidData']] as const) {
   assert.equal(call(root, ['new', 'feature', id, '--title', id, '--pages', pages], ErrorOutput, '', 1).error, error);
   assert.equal(existsSync(join(root, 'docs/feature', id)), false);
 }
 assert.equal(call(root, ['new', 'engineering', 'invalid', '--title', 'Invalid', '--pages', 'cli'], ErrorOutput, '', 1).error, 'InvalidInput');
 assert.equal(existsSync(join(root, 'docs/engineering/invalid')), false);
 const engineering = call(root, ['new', 'engineering', 'small', '--title', 'Small'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(engineering.changedPaths, ['docs/engineering/small/README.md']);
 const engineeringShow = call(root, ['show', 'small'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }));
 assert.equal(engineeringShow.document.path, 'docs/engineering/small/README.md');
 assert.equal('body' in engineeringShow.document, false);
 write(root, 'docs/feature/conflict/cli.md', '# Existing\n');
 assert.equal(call(root, ['new', 'feature', 'conflict', '--title', 'Conflict', '--pages', 'cli'], ErrorOutput, '', 1).error, 'DocumentExists');
 assert.equal(existsSync(join(root, 'docs/feature/conflict/README.md')), false);
 assert.equal(readFileSync(join(root, 'docs/feature/conflict/cli.md'), 'utf8'), '# Existing\n');
 call(root, ['new', 'design', 'minimal-design', '--title', 'Design', '--alternative', 'one'], Ack);
 for (const file of ['README.md', 'GOALS.md', 'LIMITS.md', 'CASES.md', 'DECISION.md', 'plans/one/README.md']) assert.equal(existsSync(join(root, 'docs/design/minimal-design', file)), true);
 assert.equal(existsSync(join(root, 'docs/design/minimal-design/plans/one/cli.md')), false);
 call(root, ['new', 'roadmap', 'minimal-roadmap', '--title', 'Roadmap'], Ack);
 call(root, ['roadmap', 'adopt', 'minimal-roadmap', '--feature', 'adopted-minimal'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/adopted-minimal/README.md')), true);
 assert.equal(existsSync(join(root, 'docs/feature/adopted-minimal/cli.md')), false);
})));

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI returns a named failure for a known skipped declaration',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('skipped');
 writeProjectConfig(root, { ...readProjectConfig(root), runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 } });
 call(root,['new', 'feature','skip-feature','--title','Skip feature','--body','-'],Ack);
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @feature docs/feature/skip-feature/README.md\n// @status retired\ntest.skip('skipped',()=>{});\n");
 write(root,'test/browser.test.ts',"// @feature docs/feature/skip-feature/README.md\ntest.describe('session', () => { test('fails closed', () => {}); });\n");
 const skippedCase = deriveTestReference('test/skipped.test.mjs', 'test/skipped.test.mjs', caseDiscriminator('docs/feature/skip-feature/README.md', 0));
 assert.equal(call(root,['check'],CheckOutput).ok,true);
 assert.equal(call(root,['test','run',skippedCase],ErrorOutput,'',1).error,'CaseNotRunnable');
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed concepts actions preserve Markdown and allow generic whole-file saves', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('markdown-catalog-cli');
 call(root, ['new', 'feature', 'catalog', '--title', 'Catalog'], Ack);
 const path = 'docs/feature/catalog/concepts.md';
 const source = '# Terms\r\n\r\n## Memory {#memory}\r\n\r\nA durable finding.\r\n\r\n<!-- Author spacing -->\r\n';
 const receiptSchema = Schema.Struct({ source: Schema.String, digest: Schema.String });
 const created = call(root, ['concepts', 'set', '--path', path, '--body', '-', '--expected-digest', 'null'], receiptSchema, source);
 assert.equal(created.source, source);
 assert.equal(readFileSync(join(root, path), 'utf8'), source);
 const updated = source + '\r\n';
 const saved = call(root, ['action', '--input', '-'], receiptSchema, JSON.stringify({ action: 'concepts.set', path, source: updated, expectedDigest: created.digest }));
 assert.equal(saved.source, updated);
 assert.equal(call(root, ['concepts', 'set', '--path', path, '--body', '-', '--expected-digest', created.digest], ErrorOutput, source, 1).error, 'PreimageChanged');
 call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path, body: source, expectedDigest: saved.digest }));
 assert.equal(readFileSync(join(root, path), 'utf8'), source);
 write(root, 'docs/ignored/concepts.json', 'not parsed or reported');
 const index = call(root, ['concepts', 'index'], Schema.Struct({ catalogs: Schema.Array(Schema.Struct({ path: Schema.String })), diagnostics: Schema.Array(Schema.Unknown) }));
 assert(index.catalogs.every(item => item.path.endsWith('/concepts.md')));
 assert.equal(index.diagnostics.length, 0);
})));
