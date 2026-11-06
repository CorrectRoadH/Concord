import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.ts';


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
