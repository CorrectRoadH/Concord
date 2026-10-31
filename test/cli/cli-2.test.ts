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
