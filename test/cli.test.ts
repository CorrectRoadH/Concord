import { createConsumer } from './support/consumer.js';
import { packConcord, installConcord } from './installed-package.js';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Effect, Schema } from 'effect';
import { chromium, expect, type Browser } from '@playwright/test';
import { authorDesignFixture } from './design-fixture.js';
import { pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh } from './support.js';
import { ProjectSchema, digest } from '../src/shared.js';
import { caseDiscriminator, deriveTestReference } from '../src/test-reference.js';
import { parseDocumentRecord, renderDocument } from '../src/documents.js';
import { HAWDB_REVISION, openHawdb } from '../src/hawdb-native.js';
import { verifyInstalledNative } from '../scripts/verify-installed-native.js';
import { settleRefreshes } from '../scripts/perf/process.js';
const Ack = Schema.Struct({});
const ErrorOutput = Schema.Struct({ error: Schema.String });
const DigestOutput = Schema.Struct({ digest: Schema.String });
const PageOutput = Schema.Struct({ body: Schema.String, digest: Schema.String });
const AnnotationOutput = Schema.Struct({ snippet: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });
const TraceOutput = Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) });
const DoctorOutput = Schema.Struct({ cases: Schema.Int, missingTestRoots: Schema.Array(Schema.String) });
const DryRunOutput = Schema.Struct({ dryRun: Schema.Boolean });
const OwnerOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Unknown }) });
const StateOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ state: Schema.String }) }) });
const DecisionOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ decision: Schema.Struct({ selected: Schema.String }) }) }) });
const MemoryLifecycleOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ status: Schema.String }) }) });
const TemplatesOutput = Schema.Struct({ templates: Schema.Array(Schema.Struct({ name: Schema.String })) });
const scratch=mkdtempSync(join(tmpdir(),'concord-installed-'));
let cli: string;
before(() => Effect.runPromise(Effect.sync(()=>{
 const packed = packConcord(scratch);
 assert.ok(packed);
 assert.ok(packed.files.some(file=>file.path==='pnpm-lock.yaml'), 'package must carry its runtime dependency lock');
 const install=join(scratch,'tool');mkdirSync(install);writeFileSync(join(install,'package.json'),JSON.stringify({private:true}));
 installConcord(install, packed, [], { private: true });
 const packageRoot=join(install,'node_modules/concord-sdlc');
 const manifest=Schema.Struct({version:Schema.String,dependencies:Schema.Record(Schema.String,Schema.String),devDependencies:Schema.Record(Schema.String,Schema.String)});
 const published=Schema.decodeUnknownSync(Schema.fromJsonString(manifest))(readFileSync(join(packageRoot,'package.json'),'utf8'));
 for (const name of ['pnpm-lock.yaml','pnpm-workspace.yaml']) assert.equal(readFileSync(join(packageRoot,name),'utf8'),readFileSync(new URL('../'+name,import.meta.url),'utf8'));
 cli=join(install,'node_modules/concord-sdlc/dist/entry.js');
 assert.equal(execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim(),`concord v${published.version}`);
})));
after(() => Effect.runPromise(Effect.gen(function*() {
 yield* settleRefreshes(join(scratch, 'async-query'));
 yield* Effect.sync(() => rmSync(scratch, { recursive: true, force: true }));
})));

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

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name packed-operation-boundaries
test('packed local operations isolate unrelated malformed contracts and check reports all failures', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('operation-boundaries');
 call(root, ['new', 'feature', 'target', '--title', 'Target'], Ack);
 call(root, ['new', 'feature', 'broken-a', '--title', 'Broken A'], Ack);
 call(root, ['new', 'feature', 'broken-b', '--title', 'Broken B'], Ack);
 for (const id of ['broken-a', 'broken-b']) write(root, `docs/feature/${id}/README.md`, '---\nformat: concord.document/v1\nkind: feature\n---\n# Incomplete owner\n');
 const target = 'docs/feature/target/README.md';
 assert.match(call(root, ['code', 'annotate', '--scope', 'file', '--contract', target], AnnotationOutput).snippet, /@concord-implements docs\/feature\/target\/README.md/u);
 assert.match(call(root, ['test', 'annotate', '--contract', target], AnnotationOutput).snippet, /@feature docs\/feature\/target\/README.md/u);
 call(root, ['new', 'memory', 'repair-note', '--title', 'Repair note', '--type', 'note'], Ack);
 const index = call(root, ['memory', 'index'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })) }));
 const note = index.documents.find(record => record.path === 'memory/repair-note.md');
 assert.ok(note);
 call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path: note.path, body: '---\ntype: note\nstatus: captured\n---\n\n# Repair note\n\nObserved broken contract metadata.\n', expectedDigest: note.digest }));
 const recalled = call(root, ['memory', 'recall', 'broken contract'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ body: Schema.String })) }));
 assert.equal(recalled.documents.length, 1);
 assert.match(recalled.documents[0]!.body, /Observed broken contract metadata/u);
 const listed = call(root, ['list', 'memory'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) }));
 assert.equal(listed.documents[0]?.id, 'repair-note');
 call(root, ['new', 'issue', 'repair-observation', '--title', 'Repair observation'], Ack);
 assert.equal(call(root, ['list', 'issue'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) })).documents[0]?.id, 'repair-observation');
 const checked = call(root, ['check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String })) }), '', 1);
 assert.equal(checked.ok, false);
 for (const id of ['broken-a', 'broken-b']) assert.ok(checked.findings.some(finding => finding.path === `docs/feature/${id}/README.md`));
 assert.equal(call(root, ['code', 'annotate', '--scope', 'file', '--contract', 'docs/feature/broken-a/README.md'], ErrorOutput, '', 1).error, 'InvalidData');
})));

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('installed HawDB caches and current recall work through an installation symlink without Rust or a database helper', () =>
  Effect.runPromise(Effect.gen(function*() {
    const installation = yield* Effect.sync(() => {
      const directory = mkdtempSync(join(scratch, 'private-native-'));
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true }));
      installConcord(directory, packConcord(scratch), [], { private: true });
      return directory;
    });
    const alias = join(scratch, 'opt-concord');
    yield* Effect.sync(() => symlinkSync(join(installation, 'node_modules/concord-sdlc'), alias));
    yield* verifyInstalledNative(alias);
  })));

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

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('memory note stays captured and decision activation writes only current fields', () => {
 const root = consumer('memory-note-activation');
 call(root, ['new', 'memory', 'triage-note', '--title', 'Triage note', '--type', 'note'], Ack);
 assert.equal(call(root, ['show', 'memory/triage-note.md'], MemoryLifecycleOutput).document.metadata.status, 'captured');
 assert.equal(call(root, ['memory', 'activate', 'triage-note', '--reason', 'Classify'], ErrorOutput, '', 1).error, 'InvalidMemoryState');
 call(root, ['new', 'memory', 'choice', '--title', 'Choice', '--type', 'decision'], Ack);
 call(root, ['memory', 'activate', 'choice', '--reason', 'Adopt'], Ack);
 assert.equal(call(root, ['show', 'memory/choice.md'], MemoryLifecycleOutput).document.metadata.status, 'current');
 assert.doesNotMatch(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /epoch:|history:|createdAt:/);
});
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

function call<A>(root: string,args: readonly string[],schema: Schema.ConstraintDecoder<A, never>,input='Contract body.\n',status=0): A {
 const result=spawnSync(process.execPath,[cli,'--root',root,'--json','--fresh',...args],{input,encoding:'utf8',timeout:20000});
 assert.equal(result.status,status,JSON.stringify({args,signal:result.signal,stdout:result.stdout,stderr:result.stderr,error:result.error}));
 return Schema.decodeUnknownSync(Schema.fromJsonString(schema), { onExcessProperty: 'ignore', errors: 'all' })(status===0||result.stdout.trim()?result.stdout:result.stderr);
}
function callString(root: string,args: readonly string[],input='Contract body.\n',status=0): string {
 return call(root, args, Schema.String, input, status);
}
function clearDecision(root: string, id: string) { const path = `docs/design/${id}/DECISION.md`; write(root, path, readFileSync(join(root, path), 'utf8').replace(/^Selected:.*$/mu, '')); }
function readPage(root: string, path: string) { const body = readFileSync(join(root, path), 'utf8'); return { body, digest: digest(body) }; }
function savePage(root: string, path: string, body: string, expectedDigest: string, status = 0) {
 return call(root, ['action', '--input', '-'], status === 0 ? Ack : ErrorOutput, JSON.stringify({ action: 'document.set', path, body, expectedDigest }), status) as { error?: string };
}
function consumer(name: string){const root=join(scratch,name);cpSync(createConsumer(),root,{recursive:true});writeProjectConfig(root,{testRoots:['test','tests']});return root;}
function write(root: string,path: string,source: string){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),source);}
// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('packed feedback commands persist connections and local triage without remote calls', () => Effect.runPromise(Effect.sync(() => {
 const root=consumer('packed-feedback');
 call(root,['feedback','connection','add','--id','github-main','--provider','github','--owner','example','--repo','demo','--credential-env','CONCORD_TEST_MISSING_TOKEN'],Ack);
 call(root,['feedback','connection','add','--id','linear-main','--provider','linear','--team','TEAM','--credential-env','CONCORD_TEST_MISSING_LINEAR_KEY'],Ack);
 const project=readProjectConfig(root);
 assert.deepEqual(project.feedbackConnections?.map(connection=>connection.provider),['github','linear']);
 call(root,['new', 'feature','feedback-target','--title','Feedback target'],Ack);
 call(root,['new', 'issue','observation','--title','Local observation'],Ack);
 call(root,['issue','link','observation','--role','adopts','docs/feature/feedback-target/README.md'],Ack);
 const relative='docs/issues/observation.md';
 const linked=parseDocumentRecord(relative,readFileSync(join(root,relative),'utf8'));
 assert.equal(linked?.metadata.kind,'issue');
 if(linked?.metadata.kind!=='issue')assert.fail('feedback must retain the local issue owner');
 assert.deepEqual(linked.metadata.relations.filter(relation => relation.role === 'adopts').map(relation => relation.target),['docs/feature/feedback-target/README.md']);
 assert.equal(linked.metadata.source,undefined);
 const listed=call(root,['feedback','list'],Schema.Unknown);
 assert.match(JSON.stringify(listed),/observation/);
 call(root,['feedback','show','observation'],Schema.Unknown);
 call(root,['issue','close','observation','--reason','Investigation complete'],Ack);
 call(root,['new', 'issue','pending','--title','Pending observation'],Ack);
 const feedbackList=Schema.Struct({feedback:Schema.Array(Schema.Struct({document:Schema.Struct({metadata:Schema.Struct({id:Schema.String})})}))});
 const issueList=Schema.Struct({drafts:Schema.Array(Schema.Struct({metadata:Schema.Struct({id:Schema.String})}))});
 assert.deepEqual(call(root,['feedback','list','--provider','local','--state','closed','--triage','closed','--query','LOCAL'],feedbackList).feedback.map(item=>item.document.metadata.id),['observation']);
 assert.deepEqual(call(root,['feedback','list','--state','open','--triage','pending'],feedbackList).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.deepEqual(call(root,['feedback','list','--provider','github'],feedbackList).feedback,[]);
 assert.deepEqual(call(root,['action','--input','-'],feedbackList,JSON.stringify({action:'feedback.list',provider:'local',state:'open',triage:'pending'})).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.deepEqual(call(root,['action','--input','-'],issueList,JSON.stringify({action:'issue.list',state:'closed'})).drafts.map(item=>item.metadata.id),['observation']);
 call(root,['action','--input','-'],ErrorOutput,JSON.stringify({action:'feedback.list',state:'draft'}),1);
 const closed=parseDocumentRecord(relative,readFileSync(join(root,relative),'utf8'));
 assert.equal(closed?.metadata.kind==='issue'&&closed.metadata.status,'closed');
 call(root,['feedback','connection','remove','github-main'],Ack);
 assert.ok(existsSync(join(root,relative)),'removing a connection must preserve local observations');
 assert.equal(call(root,['check'],CheckOutput).ok,true);
})));
// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('packed PR export compares the actual target and serves a safe static review under a subpath', async () => {
 const root = join(scratch, 'pr-export'); mkdirSync(root);
 const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
 git('init', '-q', '-b', 'release'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
 write(root,'docs/old.md','# Before\n\nShared text.\n');
 write(root,'source.ts','export const value = 1;\n');
 git('add','.'); git('commit','-qm','ancestor'); const ancestor = git('rev-parse','HEAD');
 git('checkout','-qb','topic');
 git('mv','docs/old.md','docs/renamed.md');
 write(root,'source.ts','export const value = 2;\n');
 write(root,'docs/new.md','# After\n\n<script>window.previewExecuted = true</script>\n\n![remote](https://example.invalid/tracker.png)\n\n```p5\nwindow.previewExecuted = true\n```\n');
 writeFileSync(join(root,'binary.dat'),Buffer.from([0,1,2,3]));
 git('add','.'); git('commit','-qm','PR changes'); const head = git('rev-parse','HEAD');
 git('checkout','-q','release'); write(root,'target-only.txt','Do not show in PR\n'); git('add','.');git('commit','-qm','target advance');const base = git('rev-parse','HEAD');
 git('checkout','-q','topic'); write(root,'source.ts','PRIVATE DIRTY CONTENT\n');
 write(root,'.gitattributes','* -diff\n'); write(root,'concord.config.ts','throw new Error("must not execute configuration");\n');
 git('config','diff.external','must-not-run'); git('config','diff.ignoreSubmodules','all');
 const out = join(scratch,'exported-pr');
 const result = spawnSync(process.execPath,['--no-addons',cli,'--root',join(root,'docs'),'--json','view','export','--base',base,'--head',head,'--base-label','release','--out',out],{encoding:'utf8',timeout:120000});
 assert.equal(result.status,0,result.stderr + result.stdout);
 const { decodeChangePreview } = await import(pathToFileURL(join(cli,'../change-preview.js')).href) as typeof import('../src/change-preview.js');
 const data = decodeChangePreview(JSON.parse(readFileSync(join(out,'changes.json'),'utf8')));
 assert.deepEqual(data.comparison,{base,head,mergeBase:ancestor,baseLabel:'release'});
 assert.deepEqual(data.entries.map(entry=>entry.path).sort(),['binary.dat','docs/new.md','docs/renamed.md','source.ts']);
 assert.equal(data.entries.find(entry=>entry.path==='docs/renamed.md')?.previousPath,'docs/old.md');
 assert.equal(data.entries.find(entry=>entry.path==='binary.dat')?.binary,true);
 assert.match(data.entries.find(entry=>entry.path==='source.ts')!.patch,/\+export const value = 2/u);
 assert.doesNotMatch(JSON.stringify(data),/PRIVATE DIRTY|target-only/u);
 assert.throws(()=>decodeChangePreview({...data,unrecognized:true}));
 assert.throws(()=>decodeChangePreview({...data,entries:[...data.entries,data.entries[0]]}));
 const again = spawnSync(process.execPath,[cli,'--root',root,'--json','view','export','--base',base,'--head',head,'--out',out],{encoding:'utf8'});
 assert.equal(again.status,1); assert.match(again.stderr,/PreviewOutputExists/u);
 const server = createServer((request,response)=>{
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if(!pathname.startsWith('/pr/concord/')){response.writeHead(404).end();return;}
  const relative = decodeURIComponent(pathname.slice('/pr/concord/'.length)) || 'index.html';
  if(relative.split('/').includes('..')){response.writeHead(400).end();return;}
  try {const bytes = readFileSync(join(out,relative));response.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':'text/html');response.end(bytes);}
  catch {response.writeHead(404).end();}
 });
 let browser: Browser | undefined;
 try {
  server.listen(0,'127.0.0.1');await once(server,'listening');const address = server.address();assert.ok(address && typeof address==='object');
  const executablePath=process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium')?'/run/current-system/sw/bin/chromium':undefined);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  const page=await browser.newPage();const unexpected:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1'||new URL(request.url()).pathname.startsWith('/api/'))unexpected.push(request.url());});
  await page.goto(`http://127.0.0.1:${address.port}/pr/concord/`);
  await expect(page.getByText('release',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'source.ts',exact:true}).click();await expect(page.locator('[data-git-diff]')).toContainText('value = 2');
  await page.getByRole('button',{name:'docs/new.md',exact:true}).click();
  await page.getByRole('button',{name:'变更后',exact:true}).click();await expect(page.getByRole('heading',{name:'After',exact:true})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);assert.equal(await page.evaluate(()=>Reflect.get(window,'previewExecuted')),undefined);
  await page.reload();await expect(page.getByRole('heading',{name:'After',exact:true})).toBeVisible();assert.deepEqual(unexpected,[]);
 } finally {try {await browser?.close();} finally {await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));}}
});

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('packed PR export preserves Git object types and refuses unsafe or incomplete exports', async () => {
 const root=join(scratch,'pr-export-boundaries');mkdirSync(root);
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 write(root,'empty.md','');write(root,'type.txt','ordinary content\n');write(root,'executable.sh','echo hello\n');write(root,'old.md','# Kept\n');
 git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 rmSync(join(root,'empty.md'));rmSync(join(root,'type.txt'));symlinkSync('/etc/passwd',join(root,'type.txt'));
 git('mv','old.md','空 白\n名.md');git('add','.');git('update-index','--chmod=+x','executable.sh');git('update-index','--add','--cacheinfo',`160000,${base},submodule`);
 git('commit','-qm','object types');const head=git('rev-parse','HEAD');git('replace',head,base);git('config','diff.ignoreSubmodules','all');
 const invoke=(out:string,baseline=base,candidate=head)=>spawnSync(process.execPath,[cli,'--root',root,'--json','view','export','--base',baseline,'--head',candidate,'--out',out],{encoding:'utf8',timeout:120000});
 const out=join(scratch,'types-preview');const success=invoke(out);assert.equal(success.status,0,success.stderr);
 const {decodeChangePreview}=await import(pathToFileURL(join(cli,'../change-preview.js')).href) as typeof import('../src/change-preview.js');
 const data=decodeChangePreview(JSON.parse(readFileSync(join(out,'changes.json'),'utf8')));
 assert.equal(data.entries.find(entry=>entry.path==='submodule')?.after?.mode,'160000');
 assert.equal(data.entries.find(entry=>entry.path==='type.txt')?.status,'T');assert.equal(data.entries.find(entry=>entry.path==='type.txt')?.after?.mode,'120000');
 assert.equal(data.entries.find(entry=>entry.path==='executable.sh')?.after?.mode,'100755');
 const removed=data.entries.find(entry=>entry.path==='empty.md');assert.equal(removed?.beforeMarkdown,'');assert.equal(removed?.after,null);
 assert.equal(data.entries.find(entry=>entry.path==='空 白\n名.md')?.previousPath,'old.md');assert.doesNotMatch(JSON.stringify(data),/root:x:/u);
 const sentinel=join(out,'keep');writeFileSync(sentinel,'unknown');assert.match(invoke(out).stderr,/PreviewOutputExists/u);assert.equal(readFileSync(sentinel,'utf8'),'unknown');
 assert.match(invoke(root).stderr,/PreviewUnsafeOutput/u);assert.match(invoke(join(root,'.git','export')).stderr,/PreviewUnsafeOutput/u);
 const alias=join(scratch,'preview-output-alias');symlinkSync(scratch,alias,'dir');assert.match(invoke(join(alias,'no-output')).stderr,/PreviewUnsafeOutput/u);
 const missing=join(scratch,'missing-history-preview');assert.equal(invoke(missing,'no-such-branch').status,1);assert.equal(existsSync(missing),false);
 const shallow=join(scratch,'shallow-pr');execFileSync('git',['clone','--quiet','--depth','1',pathToFileURL(root).href,shallow]);
 const shallowResult=spawnSync(process.execPath,[cli,'--root',shallow,'--json','view','export','--base','HEAD','--out',join(scratch,'shallow-out')],{encoding:'utf8'});assert.match(shallowResult.stderr,/PreviewShallowRepository/u);
 git('replace','-d',head);
 writeFileSync(join(root,'oversized.txt'),Buffer.alloc(4*1024*1024+1,97));git('add','oversized.txt');git('commit','-qm','large object');
 const large=join(scratch,'large-out');assert.match(invoke(large,head,'HEAD').stderr,/PreviewBudgetExceeded/u);assert.equal(existsSync(large),false);
 rmSync(join(root,'oversized.txt'));git('add','-A');git('commit','-qm','remove large object');const clean=git('rev-parse','HEAD');
 // Darwin rejects invalid UTF-8 filenames before Git can record them.
 if(process.platform==='linux'){
  const invalid=Buffer.concat([Buffer.from(root+'/'),Buffer.from([255])]);writeFileSync(invalid,'bytes');git('add','-A');git('commit','-qm','non UTF-8 path');
  assert.match(invoke(join(scratch,'invalid-path-out'),clean,'HEAD').stderr,/GitPathEncodingUnsupported/u);
 }
 if(process.platform!=='win32'){
  const shim=join(scratch,'cancel-git');mkdirSync(shim);const temporary=join(scratch,'cancel-tmp');mkdirSync(temporary);const pidFile=join(scratch,'cancel-git.pid');
  const realGit=execFileSync('sh',['-c','command -v git'],{encoding:'utf8'}).trim();
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(join(shim,'git'),`#!/bin/sh\ncase " $* " in *" diff "*) echo $$ > "$CONCORD_TEST_GIT_PID"; sleep 60 & wait;; *) exec ${quote(realGit)} "$@";; esac\n`,{mode:0o755});
  const child=spawn(process.execPath,[cli,'--root',root,'--json','view','export','--base',base,'--head',head,'--out',join(scratch,'cancelled-out')],{env:{...process.env,PATH:shim+':'+process.env.PATH,TMPDIR:temporary,CONCORD_TEST_GIT_PID:pidFile},stdio:'ignore'});
  const exited=once(child,'exit');
  try{
   const deadline=Date.now()+15000;while(!existsSync(pidFile)&&Date.now()<deadline)await Effect.runPromise(Effect.sleep('20 millis'));
   assert.ok(existsSync(pidFile),'export reached the scoped Git comparison');const pid=Number(readFileSync(pidFile,'utf8').trim());
   child.kill('SIGTERM');await exited;assert.throws(()=>process.kill(pid,0));assert.deepEqual(readdirSync(temporary),[],'interruption releases the temporary Git repository');
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 }
});

// @use-case docs/feature/web-workbench/use-case/review-local-changes.md
test('packed view serves its frontend and API without credentials in an isolated Git consumer', async () => {
 const root = consumer('packed-web');
 write(root, 'implementation.ts', 'export const value = "original";\n');
 execFileSync('git', ['-C', root, 'add', '.']);
 execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
 write(root, 'implementation.ts', 'export const value = "staged";\n');
 execFileSync('git', ['-C', root, 'add', 'implementation.ts']);
 write(root, 'implementation.ts', 'export const value = "working";\n');
 const process = spawn(globalThis.process.execPath, [cli, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
 const exited = once(process, 'exit');
 let browser: Browser | undefined;
 try {
  const ready = await new Promise<{address:string;host:string;port:number;local:readonly string[];network:readonly string[]}>((resolveReady, reject) => {
   let buffer='';
   const timer=setTimeout(()=>reject(new Error('Packed view did not become ready')),15000);
   process.once('exit',()=>{clearTimeout(timer);reject(new Error('Packed view exited before readiness'));});
   process.stdout.on('data',(chunk:Buffer)=>{
    buffer+=chunk.toString('utf8');
    const newline=buffer.indexOf('\n'); if(newline<0)return;
    try {const value=Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literal('view'),root:Schema.String,address:Schema.String,host:Schema.String,port:Schema.Int,local:Schema.Array(Schema.String),network:Schema.Array(Schema.String)}),{onExcessProperty:'error'})(JSON.parse(buffer.slice(0,newline)));clearTimeout(timer);resolveReady(value);} catch (cause) { clearTimeout(timer); reject(cause); }
   });
  });
  const help = execFileSync(globalThis.process.execPath, [cli, 'view', '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(help, /key|login|authenticated|密钥/iu);
  const base=ready.address.replace('localhost','127.0.0.1');
  assert.equal(ready.host,'127.0.0.1');
  assert.ok(ready.port > 0);
  assert.deepEqual(ready.local,[base]);
  assert.deepEqual(ready.network,[]);
  const shell=await fetchFresh(base+'feature/accounts');
  assert.equal(shell.status,200);
  const html=await shell.text();
  assert.match(html,/<div id="root"><\/div>/);
  const script=/src="([^"]+\.js)"/.exec(html)?.[1]; assert.ok(script);
  const asset=await fetchFresh(new URL(script,base)); assert.equal(asset.status,200);
  assert.match(asset.headers.get('content-type')??'',/javascript/);
  assert.ok((await asset.arrayBuffer()).byteLength > 0);
  const workspace = await waitForWorkspaceProjection(new URL(base).origin, { timeoutMs: 60_000 });
  assert.ok(workspace.snapshot.root === root);
  assert.equal(workspace.projection.current, false);
  assert.equal((await fetchFresh(base+'api/missing')).status,404);
  assert.equal(call(root,['check'],CheckOutput).ok,true,'idle server must not lock out the CLI');
  const executablePath = globalThis.process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**/api/git', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'GitFailed', message: 'Git fixture unavailable' }) }));
  await page.goto(base);
  await expect(page).toHaveURL(new URL('git', base).href);
  await expect(page.getByRole('alert')).toContainText('Git fixture unavailable');
  await page.unroute('**/api/git');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'implementation.ts', exact: true })).toBeVisible();
  await expect(page.locator('[data-git-diff]')).toContainText('working');
  await page.getByRole('tab', { name: '已暂存', exact: true }).click();
  await expect(page.locator('[data-git-diff]')).toContainText('original');
  await expect(page.locator('[data-git-diff]')).not.toContainText('working');
  await page.reload();
  await expect(page.getByRole('tab', { name: '已暂存', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /文档/ }).click();
  await expect(page.getByRole('button', { name: 'implementation.ts', exact: true })).toHaveCount(0);
 } finally {try {await browser?.close();} finally {process.kill('SIGTERM');await exited;}}
});
// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('packed HTTP workspace projection reads the shared generation and holds warm budgets', async t => {
 const root = consumer('packed-projection');
 call(root,['new', 'feature','projected','--title','Projected','--pages','architecture'],Ack);
 const server = spawn(globalThis.process.execPath, [cli, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
 const exited = once(server, 'exit');
 try {
  const ready = await new Promise<{address:string}>((resolveReady, reject) => {
   let buffer='';
   const timer=setTimeout(()=>reject(new Error('Packed view did not become ready')),15000);
   server.once('exit',()=>{clearTimeout(timer);reject(new Error('Packed view exited before readiness'));});
   server.stdout.on('data',(chunk:Buffer)=>{
    buffer+=chunk.toString('utf8');
    const newline=buffer.indexOf('\n'); if(newline<0)return;
    try {const value=Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literal('view'),address:Schema.String}),{onExcessProperty:'ignore'})(JSON.parse(buffer.slice(0,newline)));clearTimeout(timer);resolveReady(value);} catch (cause) { clearTimeout(timer); reject(cause); }
   });
  });
  const base=ready.address.replace('localhost','127.0.0.1');
  const initial = await waitForWorkspaceProjection(new URL(base).origin, { timeoutMs: 60_000 });
  let projectionBytes = 0;
  const httpSample = async () => {
   const started = performance.now();
   const response = await fetchFresh(base+'api/workspace');
   const size = (await response.arrayBuffer()).byteLength;
   const ms = performance.now() - started;
   assert.equal(response.status, 200);
   projectionBytes = size;
   return ms;
  };
  await httpSample();
  const httpTimes: number[] = [];
  for (let index = 0; index < 7; index += 1) httpTimes.push(await httpSample());
  httpTimes.sort((a, b) => a - b);
  const percentile = (sorted: readonly number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
  const httpP50 = percentile(httpTimes, 0.5), httpP95 = percentile(httpTimes, 0.95);
  t.diagnostic(`workspace projection: docs=${initial.snapshot.documents.length} pages=${initial.snapshot.pages.length} bytes=${projectionBytes} native=${HAWDB_REVISION} node=${process.version} ${process.platform}-${process.arch}`);
  t.diagnostic(`HTTP warm p50=${httpP50.toFixed(1)}ms p95=${httpP95.toFixed(1)}ms`);
  assert.ok(httpP50 <= 250, `HTTP warm p50 ${httpP50}ms exceeds 250ms`);
  assert.ok(httpP95 <= 600, `HTTP warm p95 ${httpP95}ms exceeds 600ms`);

 } finally {server.kill('SIGTERM');await exited;}
});
// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed templates work outside a project and fail clearly when their inventory is damaged', () => Effect.runPromise(Effect.sync(() => {
 const installation = mkdtempSync(join(scratch, 'private-templates-'));
 writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true }));
 installConcord(installation, packConcord(scratch), [], { private: true });
 const cli = join(installation, 'node_modules/concord-sdlc/dist/entry.js');
 const result = spawnSync(process.execPath, [cli, 'template', 'list', '--json'], { cwd: scratch, encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr);
 const templates = Schema.decodeUnknownSync(Schema.fromJsonString(TemplatesOutput))(result.stdout);
 assert.ok(templates.templates.some(item => item.name === 'engineering'));
 const shown = spawnSync(process.execPath, [cli, 'template', 'show', 'feature', '--title', 'Accounts'], { cwd: scratch, encoding: 'utf8' });
 assert.equal(shown.status, 0, shown.stderr);
 assert.match(shown.stdout, /# Accounts/);
 const template = join(cli, '../../templates/feature.md');
 const original = readFileSync(template, 'utf8');
 try {
  rmSync(template);
  const broken = spawnSync(process.execPath, [cli, 'template', 'list', '--json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(broken.status, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(broken.stderr).error, 'TemplateInventoryInvalid');
 } finally { writeFileSync(template, original); }
})));
// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('installed onboarding creates editable packages and connects supporting-page tests to their Feature', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('onboarding');
 const guide = readFileSync(join(root, 'docs/concord.md'), 'utf8');
 assert.match(guide, /concord test list/);
 assert.match(guide, /a product direction in the same genre as Feature that has not been adopted yet\. Its design is incomplete, or it is designed but not scheduled/u);
 assert.match(guide, /Behavior pages \(Feature README, Use Case, cli, library\) state commands, real human and JSON output, exit codes, and named errors\./u);
 assert.match(guide, /The architecture page states how the Feature is implemented\. Run `concord --skill document` for the full rules\./u);
 for (const path of ['docs/README.md', 'docs/_template/roadmap/use-case/README.md', 'docs/_template/design-decision/CASES.md', 'docs/_template/design-decision/plans/plan-2/library.md', 'docs/_template/engineering/README.md', 'docs/concepts.md', 'docs/architecture.md', 'docs/_template/research/README.md', 'docs/_template/memory/note.md']) assert.equal(existsSync(join(root, path)), true, path);
 assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /BEGIN CONCORD AGENT INSTRUCTIONS[\s\S]*concord trace gaps --json/u);
 call(root, ['new', 'feature', 'accounts', '--title', 'Accounts', '--pages', 'library,cli,architecture,use-case'], Ack);
 for (const page of ['README.md', 'library.md', 'cli.md', 'architecture.md', 'use-case/README.md']) assert.equal(existsSync(join(root, 'docs/feature/accounts', page)), true, page);
 call(root, ['new', 'feature', 'other', '--title', 'Other'], Ack);
 call(root, ['new', 'engineering', 'ci', '--title', 'Continuous integration'], Ack);
 const page = readPage(root, 'docs/feature/accounts/cli.md');
 savePage(root, 'docs/feature/accounts/cli.md', '# Accounts CLI\n\n## Sign in\n\nReject expired tokens.\n', page.digest);
 assert.equal(savePage(root, 'docs/feature/accounts/cli.md', '# Stale\n', page.digest, 1).error, 'PreimageChanged');
 const ownerBefore = call(root, ['show', 'accounts'], OwnerOutput).document;
 const readme = readPage(root, 'docs/feature/accounts/README.md');
 assert.ok(!readme.body.startsWith('---'));
 savePage(root, 'docs/feature/accounts/README.md', '# Accounts\n\nUsers sign in with valid credentials.\n', readme.digest);
 assert.deepEqual(call(root, ['show', 'accounts'], OwnerOutput).document.metadata, ownerBefore.metadata);
 call(root, ['new', 'issue', 'expired', '--title', 'Expired token'], Ack);
 const annotation = call(root, ['test', 'annotate', '--contract', 'docs/feature/accounts/cli.md#sign-in', '--issue', 'docs/issues/expired.md'], AnnotationOutput);
 assert.equal(existsSync(join(root, 'test')), false, 'annotate must not edit test sources');
 write(root, 'test/accounts.test.mjs', `import test from 'node:test';\n${annotation.snippet}test('rejects expired tokens', () => {});\n`);
 const accountCase = deriveTestReference('test/accounts.test.mjs', 'test/accounts.test.mjs', caseDiscriminator('docs/feature/accounts/cli.md#sign-in', 0));
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
 const tracedTest = call(root, ['trace', 'show', 'accounts'], TraceOutput).tests[0];
 assert.ok(tracedTest);
 assert.equal(tracedTest.id, accountCase);
 assert.equal(call(root, ['trace', 'show', 'other'], TraceOutput).tests.length, 0);
 assert.match(callString(root, ['review', 'render', 'accounts']), new RegExp(accountCase));
 assert.equal(call(root, ['doctor'], DoctorOutput).cases, 1);
 const human = spawnSync(process.execPath, [cli, '--root', root, 'test', 'list'], { encoding: 'utf8' });
 assert.equal(human.status, 0, human.stderr);
 assert.match(human.stdout, new RegExp(accountCase));
 assert.match(human.stdout, /Contract:/);
 assert.ok(!human.stdout.trimStart().startsWith('{'));
})));
// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed init previews configuration, preserves existing docs, and never runs the configured command', () => Effect.runPromise(Effect.sync(() => {
 const root = join(scratch, 'init-options'); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
 write(root, 'docs/README.md', '# Existing documentation\n');
 write(root, 'docs/concepts.md', '# Existing concepts\n');
 write(root, 'docs/architecture.md', '# Existing architecture\n');
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 const runner = { kind: 'command', argv: ['node', '-e', 'require("node:fs").writeFileSync("EXECUTED", "bad")'], sourceFiles: [], timeoutMs: 1200 };
 write(root, 'runner.json', JSON.stringify(runner));
 const args = ['init', '--test-root', 'spec', '--runner-config', join(root, 'runner.json')];
 assert.equal(call(root, ['--dry-run', ...args], DryRunOutput).dryRun, true);
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 assert.equal(existsSync(join(root, '.git/concord')), false);
 call(root, args, Ack);
 const config = readProjectConfig(root);
 assert.deepEqual(config.testRoots, ['spec']); assert.deepEqual(config.runner, runner);
 assert.equal(readFileSync(join(root, 'docs/README.md'), 'utf8'), '# Existing documentation\n');
 assert.equal(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), '# Existing concepts\n');
 assert.equal(readFileSync(join(root, 'docs/architecture.md'), 'utf8'), '# Existing architecture\n');
 const diagnosis = call(root, ['doctor'], DoctorOutput);
 assert.deepEqual(diagnosis.missingTestRoots, ['spec']);
 call(root, ['check'], CheckOutput);
 assert.equal(existsSync(join(root, 'EXECUTED')), false);
 assert.equal(call(root, ['init'], ErrorOutput, '', 1).error, 'ProjectExists');
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
// @use-case docs/feature/document-packages/use-case/organize-freeform-research.md
test('packed Research creates only its title and edits arbitrary nested supporting Markdown', () => {
 const root = consumer('research-package');
 const created = call(root, ['new', 'research', 'notes', '--title', 'My notes'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(created.changedPaths, ['docs/research/notes/README.md']);
 const owner = parseDocumentRecord('docs/research/notes/README.md', readFileSync(join(root, 'docs/research/notes/README.md'), 'utf8'))!;
 assert.equal(owner.body.trim(), '# My notes');
 write(root, 'docs/research/notes/材料/比较.md', '# 比较\n');
 const page = readPage(root, 'docs/research/notes/材料/比较.md');
 assert.equal(page.body.trim(), '# 比较');
 savePage(root, 'docs/research/notes/材料/比较.md', '# 任意结构\n\n自由正文。\n', page.digest);
 assert.equal(readFileSync(join(root, 'docs/research/notes/材料/比较.md'), 'utf8'), '# 任意结构\n\n自由正文。\n');
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
});

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('packed writing checks consumer policy, readable prose and safe input boundaries while excluding SVG', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('writing');
 const reportSchema = Schema.Struct({ ok: Schema.Boolean, files: Schema.Int, findings: Schema.Array(Schema.Struct({ file: Schema.String, line: Schema.Int, rule: Schema.String, message: Schema.String })) });
 const policy = {
  format: 'concord.writing/v3', roots: ['guide', 'guide/page.md'],
  bannedTerms: [{ term: 'bad', use: 'clear', why: 'Be precise', exempt: ['guide/exempt'] }, { term: '旧词', use: '新词', why: 'One vocabulary', allowIn: ['旧词典'] }],
  sentenceLength: 20, paragraphLength: 30, unusedConcepts: true,
 };
 mkdirSync(join(root, 'guide'));
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(policy));
 writeFileSync(join(root, 'guide/style.css'), '.label { fill: black; }\n');
 writeFileSync(join(root, 'docs/concepts.md'), "---\ndeprecated:\n  new-word:\n    - 旧称\n---\n\n# Terms\n\n## 新词 {#new-word}\n\nPreferred wording\n");
 writeFileSync(join(root, 'guide/page.md'), [
  '---', 'title: bad', '---', '# Guide', '', '新词 good 旧词典.', '',
  '```ts', 'bad', '```', '', '~~~', 'bad', '~~~', '',
  '``bad ` bad`` [clear](bad) ![bad](image.png)', '', '<!-- bad -->', '',
  'bad BAD badly 旧词 旧称', '', '甲'.repeat(15), '乙'.repeat(20) + '。',
 ].join('\n'));
 writeFileSync(join(root, 'guide/view.mdx'), ['<Panel', ' title="bad"', '>', 'clear', '</Panel>', '{/* GENERATED:BEGIN fields */}', 'bad', '{/* GENERATED:END fields */}'].join('\n'));
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text><desc>bad</desc></svg>');
 const first = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert.equal(first.files, 2);
 assert(first.findings.filter(hit => hit.rule === 'bannedTerm').length >= 4);
 assert.equal(first.findings.filter(hit => hit.rule === 'sentenceLength').length, 1);
 assert.equal(first.findings.filter(hit => hit.rule === 'paragraphLength').length, 1);
 assert(first.findings.some(hit => hit.file === 'guide/page.md' && hit.line === 22));
 assert(!first.findings.some(hit => hit.rule === 'unusedConcept' || hit.rule === 'svgTerm' || hit.rule === 'svgStyle'));
 writeFileSync(join(root, 'guide/page.md'), '新词 good 旧词典.\n');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text></svg>');
 assert.equal(call(root, ['docs', 'check'], reportSchema).ok, true);
 mkdirSync(join(root, 'guide/exempt-more'));
 writeFileSync(join(root, 'guide/exempt-more/page.md'), 'bad');
 assert(call(root, ['docs', 'check'], reportSchema, '', 1).findings.some(hit => hit.file === 'guide/exempt-more/page.md'));
 rmSync(join(root, 'guide/exempt-more'), { recursive: true });
 writeFileSync(join(root, 'guide/page.md'), 'clear');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><text class="label">幽灵</text></svg>');
 const missing = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert(missing.findings.some(hit => hit.rule === 'unusedConcept'));
 assert(!missing.findings.some(hit => hit.file.endsWith('.svg')));
 for (const invalid of [{ ...policy, svgTerms: false }, { ...policy, svgStyle: null }, { ...policy, unknown: true }, { ...policy, roots: ['../outside'] }, { ...policy, bannedTerms: [{ term: 'bad', use: '', why: 'reason' }] }]) {
  writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(invalid));
  assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 }
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ ...policy, svgTerms: false, svgStyle: null }));
 const obsolete = call(root, ['writing', 'show'], Schema.Struct({ state: Schema.String, digest: Schema.String, source: Schema.String }));
 assert.equal(obsolete.state, 'invalid');
 writeFileSync(join(root, 'clean-policy.json'), JSON.stringify(policy));
 call(root, ['--dry-run', 'writing', 'set', '--body', join(root, 'clean-policy.json'), '--expected-digest', obsolete.digest], DryRunOutput);
 assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), obsolete.source);
 call(root, ['writing', 'set', '--body', join(root, 'clean-policy.json'), '--expected-digest', obsolete.digest], Ack);
 assert.deepEqual(JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')), policy);
 writeFileSync(join(root, 'svg-action.json'), JSON.stringify({ action: 'writing.set', policy: { ...policy, svgTerms: false }, expectedDigest: obsolete.digest }));
 call(root, ['action', '--input', join(root, 'svg-action.json')], ErrorOutput, '', 1);
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ ...policy, roots: ['missing'] }));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'WritingInputNotFound');
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'UnsafePath');
 assert.equal(call(root, ['docs', 'check', '--rules', 'absent.json'], ErrorOutput, '', 1).error, 'WritingPolicyNotFound');
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed scoped owner commands use path, Markdown catalog body, null creation CAS, and standalone rules', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('scoped-owner-cli');
 write(root, 'docs/feature/sample/page.md', 'Feedback.\n');
 write(root, 'policy.json', JSON.stringify({ format: 'concord.writing/v3', bannedTerms: [] }));
 write(root, 'catalog.md', "# Terms\n\n## Feedback {#feedback}\n\nA response\n");
 const ownerPath = 'docs/feature/sample/concord-writing.json';
 const catalogPath = 'docs/feature/sample/concepts.md';
 assert.equal(call(root, ['writing', 'show', '--path', ownerPath], Schema.Struct({ state: Schema.String })).state, 'missing');
 assert.equal(call(root, ['--dry-run', 'writing', 'set', '--path', ownerPath, '--body', join(root, 'policy.json'), '--expected-digest', 'null'], DryRunOutput).dryRun, true);
 assert.equal(existsSync(join(root, ownerPath)), false);
 call(root, ['writing', 'set', '--path', ownerPath, '--body', join(root, 'policy.json'), '--expected-digest', 'null'], DigestOutput);
 call(root, ['concepts', 'set', '--path', catalogPath, '--body', join(root, 'catalog.md'), '--expected-digest', 'null'], DigestOutput);
 assert.equal(call(root, ['concepts', 'show', '--path', catalogPath], Schema.Struct({ state: Schema.String })).state, 'valid');
 assert(call(root, ['writing', 'index'], Schema.Struct({ scopes: Schema.Array(Schema.Struct({ scope: Schema.String })) })).scopes.some(item => item.scope === 'docs/feature/sample'));
 assert(call(root, ['concepts', 'index'], Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String })) })).concepts.some(item => item.reference === catalogPath + '#feedback'));
 assert.equal(call(root, ['writing', 'check', '--path', ownerPath], CheckOutput).ok, true);
 const external = consumer('standalone-owner-cli');
 rmSync(join(external, 'docs/concepts.md'));
 write(external, 'guide/page.md', 'Standalone prose.\n');
 write(external, 'rules.json', JSON.stringify({ format: 'concord.writing/v3', roots: ['guide'], bannedTerms: [] }));
 assert.equal(call(external, ['docs', 'check', '--rules', 'rules.json'], CheckOutput).ok, true);
 write(external, 'docs/concord-writing.json', JSON.stringify({ format: 'concord.writing/v1', roots: ['docs'], bannedTerms: [] }));
 assert.equal(call(external, ['docs', 'check', '--rules', 'rules.json'], CheckOutput).ok, true);
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

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('packed CLI creates and resolves Unicode Use Cases and supporting pages', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('unicode-names');
 call(root, ['new', 'feature', 'npc', '--title', 'NPC'], Ack);
 renameSync(join(root, 'docs/feature/npc'), join(root, 'docs/feature/角色目录'));
 const paths = Schema.Struct({ changedPaths: Schema.Array(Schema.String) });
 const useCase = ['new', 'use-case', '扩展NPC动作', '--feature', '角色目录', '--title', '扩展 NPC 动作'];
 const expectedPath = 'docs/feature/角色目录/use-case/扩展NPC动作.md';
 assert.deepEqual(call(root, ['--dry-run', ...useCase], paths).changedPaths, [expectedPath]);
 assert.equal(existsSync(join(root, expectedPath)), false);
 call(root, useCase, Ack);
 for (const page of ['认知与执行', '常识与上下文']) {
   write(root, `docs/feature/角色目录/${page}.md`, `# ${page}\n`);
   const before = readPage(root, `docs/feature/角色目录/${page}.md`);
   savePage(root, `docs/feature/角色目录/${page}.md`, `# ${page}\n\n中文正文。\n`, before.digest);
   assert.match(readPage(root, `docs/feature/角色目录/${page}.md`).body, /中文正文/u);
 }
 const shown = call(root, ['show', '扩展NPC动作'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }));
 assert.equal(shown.document.path, expectedPath);
 write(root, 'test/unicode.test.ts', `// @use-case ${expectedPath}\n// @name 中文用例\n`);
 const trace = call(root, ['trace', 'show', expectedPath], TraceOutput);
 assert.equal(trace.tests.length, 1);
 call(root, ['new', 'use-case', 'internal-id', '--feature', '角色目录', '--title', '内部身份与文件名独立'], Ack);
 const namedPath = 'docs/feature/角色目录/use-case/中文文件名.md';
 renameSync(join(root, 'docs/feature/角色目录/use-case/internal-id.md'), join(root, namedPath));
 assert.equal(call(root, ['show', '中文文件名'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) })).document.path, namedPath);
 write(root, 'test/named.test.ts', `// @use-case ${namedPath}\n`);
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
 assert.equal(call(root, ['trace', 'check'], CheckOutput).ok, true);
 assert.equal(call(root, ['trace', 'show', namedPath], TraceOutput).tests.length, 1);
 call(root, ['trace', 'gaps'], Ack);
 renameSync(join(root, namedPath), join(root, 'docs/feature/角色目录/中文文件名.md'));
 assert.equal(call(root, ['check'], CheckOutput, '', 1).ok, false);
 assert.equal(savePage(root, '../越界.md', '# No\n', 'sha256:unknown', 1).error, 'FileNotFound');
 assert.equal(call(root, ['new', 'use-case', '坏/名称', '--feature', '角色目录', '--title', '坏名称'], ErrorOutput, '', 1).error, 'InvalidData');
})));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('packed CLI accepts file Plans and nested directory pages with exact entry links', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('plan-file');
 call(root, ['new', 'design', 'storage', '--title', 'Storage', '--alternative', 'local', '--alternative', 'remote'], Ack);
 authorDesignFixture(root, 'storage', ['local', 'remote'], 'local');
 const base = join(root, 'docs/design/storage');
 writeFileSync(join(base, 'plans/local.md'), readFileSync(join(base, 'plans/local/README.md'), 'utf8').replaceAll('../../', '../'));
 rmSync(join(base, 'plans/local'), { recursive: true });
 writeFileSync(join(base, 'DECISION.md'), readFileSync(join(base, 'DECISION.md'), 'utf8').replace('plans/local/README.md', 'plans/local.md'));
 write(root, 'docs/design/storage/plans/remote/存储/快照.md', '# 存储/快照.md\n');
 const page = readPage(root, 'docs/design/storage/plans/remote/存储/快照.md');
 assert(page.body.includes('存储/快照.md'));
 call(root, ['design', 'check', 'storage'], CheckOutput);
 clearDecision(root, 'storage');
 call(root, ['design', 'decide', 'storage', '--selected', 'local', '--reason', 'Local'], Ack);
 call(root, ['check'], CheckOutput);
})));

// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
test('C10 C22 C24 C25: packed invalid policy rejection and controlled checks keep cache-independent public results', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('controlled-writing-v3');
 const path = 'docs/concord-writing.json';
 const original = { format: 'concord.writing/v2', roots: ['docs/corpus.md'], bannedTerms: [], sentenceLength: 100, paragraphLength: 200 };
 write(root, path, JSON.stringify(original));
 write(root, 'docs/corpus.md', '1. Read the read result.\n\nThe cache is cleared.\n');
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 const shown = call(root, ['writing', 'show'], Schema.Struct({ digest: Schema.String, source: Schema.String, state: Schema.String }));
 assert.equal(shown.state, 'invalid');
 assert.equal(readFileSync(join(root, path), 'utf8'), shown.source);
 const policy = { ...original, format: 'concord.writing/v3', controlled: { language: 'en', procedural: { singleInstruction: true, verbs: { en: [{ lemma: 'read' }] } }, passiveVoice: { en: true, participles: ['cleared'] } } };
 const current = call(root, ['writing', 'show'], DigestOutput);
 call(root, ['writing', 'set', '--body', '-', '--expected-digest', current.digest], Ack, JSON.stringify(policy));
 const Report = Schema.Struct({ complete: Schema.Boolean, findings: Schema.Array(Schema.Unknown), inputDigest: Schema.String });
 call(root, ['cache', 'clear'], Ack);
 const cold = call(root, ['docs', 'check'], Report, '', 1);
 call(root, ['cache', 'rebuild'], Ack);
 assert.deepEqual(call(root, ['docs', 'check'], Report, '', 1), cold);
 // Corrupt only disposable projection rows, retaining the native ownership inode.
 const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
 try { for (const table of ['annotation_cache', 'code_cache'] as const) for (const row of database.scan(table)) database.put(table, [{ key: row.key, payload: '{invalid' }]); }
 finally { database.close(); }
 assert.deepEqual(call(root, ['docs', 'check'], Report, '', 1), cold);
 call(root, ['cache', 'clear'], Ack);
 assert.deepEqual(call(root, ['docs', 'check'], Report, '', 1), cold);
 write(root, 'profile.json', JSON.stringify(policy));
 assert.deepEqual(call(root, ['docs', 'check', '--rules', 'profile.json'], Schema.Struct({ findings: Schema.Array(Schema.Unknown) }), '', 1).findings.map(value => { const finding = value as { source?: unknown; sources?: unknown }; return { ...finding, source: undefined, sources: undefined }; }), cold.findings.map(value => { const finding = value as { source?: unknown; sources?: unknown }; return { ...finding, source: undefined, sources: undefined }; }));
 const saved = call(root, ['writing', 'show'], DigestOutput);
 const invalid = { ...policy, controlled: { sentence: { en: { procedural: 0 } } } };
 assert.equal(call(root, ['writing', 'set', '--body', '-', '--expected-digest', saved.digest], ErrorOutput, JSON.stringify(invalid), 1).error, 'InvalidWritingPolicy');
 write(root, 'profile.json', JSON.stringify(invalid));
 assert.equal(call(root, ['docs', 'check', '--rules', 'profile.json'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 write(root, 'profile.json', JSON.stringify({ ...policy, controlled: { approvedWords: { en: Array(4097).fill('word') } } }));
 assert.equal(call(root, ['docs', 'check', '--rules', 'profile.json'], ErrorOutput, '', 1).error, 'WritingBudgetExceeded');
})));

// @feature docs/feature/project-onboarding/README.md
test('packed boundaries reject non-current formats and preserve configuration, owners, receipts, journals and locks', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('current-formats-only');
 const constitution = 'docs/constitution.md';
 const current = readFileSync(join(root, constitution), 'utf8');
 for (const source of [current.replace('---\n', '---\nformat: concord.constitution/v2\n'), current.replace('status: draft', 'status: draft\namendments: []')]) {
  write(root, constitution, source);
  assert.equal(call(root, ['constitution', 'show'], ErrorOutput, '', 1).error, 'InvalidData');
  assert.equal(readFileSync(join(root, constitution), 'utf8'), source);
 }
 write(root, constitution, current);
 const configPath = 'concord.config.ts';
 const config = readFileSync(join(root, configPath), 'utf8');
 for (const [source, code] of [['export default { projectId: \"retired\" };', 'InvalidData'], ['export default { ...{} };\n', 'InvalidConfigSyntax']] as const) {
  write(root, configPath, source);
  assert.equal(call(root, ['config', 'show'], ErrorOutput, '', 1).error, code);
  assert.equal(readFileSync(join(root, configPath), 'utf8'), source);
 }
 write(root, configPath, config);
 for (const format of ['concord.writing/v1', 'concord.writing/v2']) {
  const source = JSON.stringify({ format, bannedTerms: [] });
  write(root, 'docs/concord-writing.json', source);
  assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
  assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), source);
 }
 const id = 'ccev_11111111111111111111111111111111';
 const receiptPath = `.git/concord/evidence/${id}.json`;
 const receipt = JSON.stringify({ format: 'concord.command-evidence/v1', id });
 write(root, receiptPath, receipt);
 call(root, ['config', 'show'], Ack);
 assert.equal(readFileSync(join(root, receiptPath), 'utf8'), receipt);
 const journalPath = '.git/concord/journal.json', lockPath = '.git/concord/lock.json';
 const journal = JSON.stringify({ format: 'concord.journal', scope: { kind: 'documents' } });
 const lock = 'preserve invalid lock bytes';
 write(root, journalPath, journal); write(root, lockPath, lock);
 for (const command of ['check', 'recover']) {
  assert.equal(call(root, [command], ErrorOutput, '', 1).error, 'InvalidData');
  assert.equal(readFileSync(join(root, journalPath), 'utf8'), journal);
  assert.equal(readFileSync(join(root, lockPath), 'utf8'), lock);
 }
})));
