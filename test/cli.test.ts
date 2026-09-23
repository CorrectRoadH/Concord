import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { once } from 'node:events';
import { Effect, Schema } from 'effect';
import { authorDesignFixture } from './design-fixture.js';
import { readProjectConfig } from './support.js';
import { ProjectSchema } from '../dist/shared.js';
import { caseDiscriminator, deriveTestReference } from '../dist/test-reference.js';
import { parseDocumentRecord, renderDocument } from '../dist/documents.js';
import { verifyInstalledNative } from '../scripts/verify-installed-native.js';
const Ack = Schema.Struct({});
const ErrorOutput = Schema.Struct({ error: Schema.String });
const DigestOutput = Schema.Struct({ digest: Schema.String });
const PageOutput = Schema.Struct({ body: Schema.String, digest: Schema.String });
const AnnotationOutput = Schema.Struct({ snippet: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });
const TraceOutput = Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) });
const DoctorOutput = Schema.Struct({ cases: Schema.Int, missingTestRoots: Schema.Array(Schema.String) });
const DryRunOutput = Schema.Struct({ dryRun: Schema.Boolean });
const EvidenceOutput = Schema.Struct({ id: Schema.String, commandOutcome: Schema.String, execution: Schema.String });
const OwnerOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Unknown }) });
const StateOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ state: Schema.String }) }) });
const DecisionOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ decision: Schema.Struct({ selected: Schema.String }) }) }) });
const ResolutionOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ state: Schema.String, resolution: Schema.Struct({ evidenceLevel: Schema.String }) }) }) });
const EpochOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ epoch: Schema.Int }) }) });
const PromotionsOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ promotions: Schema.Array(Schema.String) }) }) });
const MemoryLifecycleOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ state: Schema.String, history: Schema.Array(Schema.Struct({ action: Schema.String, reason: Schema.String })) }) }) });
const TemplatesOutput = Schema.Struct({ templates: Schema.Array(Schema.Struct({ name: Schema.String })) });
const scratch=mkdtempSync(join(tmpdir(),'concord-installed-'));
let cli: string;
before(() => Effect.runPromise(Effect.sync(()=>{
 const packed=Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({filename:Schema.String,files:Schema.Array(Schema.Struct({path:Schema.String}))}))))(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',scratch],{cwd:resolve('.'),encoding:'utf8',timeout:60000}));
 assert.ok(packed[0]);
 assert.ok(packed[0].files.some(file=>file.path==='npm-shrinkwrap.json'), 'package must carry its runtime dependency lock');
 const install=join(scratch,'tool');mkdirSync(install);writeFileSync(join(install,'package.json'),JSON.stringify({private:true}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',join(scratch,packed[0].filename)],{cwd:install,encoding:'utf8',timeout:60000});
 cli=join(install,'node_modules/concord-sdlc/dist/entry.js');
})));
after(() => Effect.runPromise(Effect.sync(()=>rmSync(scratch,{recursive:true,force:true}))));

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('installed HawDB caches and current recall work without Rust or a database helper', () =>
  Effect.runPromise(verifyInstalledNative(join(scratch, 'tool/node_modules/concord-sdlc')).pipe(Effect.asVoid)));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('packed Design commands require complete responses and preserve formatting and decision semantics', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('design-comparison');
 call(root, ['design', 'create', 'storage', '--title', 'Storage', '--alternative', 'local', '--alternative', 'remote'], Ack);
 const base = join(root, 'docs/design/storage');
 assert.match(readFileSync(join(base, 'plans/local/README.md'), 'utf8'), /## Limits/u);
 const incomplete = call(root, ['design', 'check', 'storage'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ code: Schema.String })) }), '', 1);
 assert.equal(incomplete.ok, false);
 assert(incomplete.findings.some(item => item.code === 'DesignSelectionInvalid'));
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
 const owner = readFileSync(join(base, 'README.md'), 'utf8');
 call(root, ['--dry-run', 'design', 'decide', 'storage', '--selected', 'local', '--reason', 'Offline'], DryRunOutput);
 assert.equal(readFileSync(join(base, 'README.md'), 'utf8'), owner);
 assert.equal(call(root, ['design', 'decide', 'storage', '--selected', 'remote', '--reason', 'Remote'], ErrorOutput, '', 1).error, 'DesignDecisionIncomplete');
 call(root, ['design', 'decide', 'storage', '--selected', 'local', '--reason', 'Offline'], Ack);
 assert.equal(call(root, ['design', 'show', 'storage'], DecisionOutput).document.metadata.decision.selected, 'local');
 call(root, ['design', 'check', 'storage'], CheckOutput);
})));

test('memory note uses the captured template and activation records its reason', () => {
 const root = consumer('memory-note-activation');
 call(root, ['memory', 'add', 'triage-note', '--title', 'Triage note', '--kind', 'note'], Ack);
 const captured = call(root, ['memory', 'show', 'triage-note'], MemoryLifecycleOutput).document;
 assert.equal(captured.metadata.state, 'captured');
 call(root, ['memory', 'add', 'triage-problem', '--title', 'Triage problem', '--kind', 'problem'], Ack);
 const path = 'memory/triage-problem.md';
 const pending = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'));
 assert.ok(pending?.metadata.kind === 'memory');
 write(root, path, renderDocument({ ...pending.metadata, state: 'captured' }, pending.body));
 call(root, ['memory', 'activate', 'triage-problem', '--reason', 'Begin investigation'], Ack);
 const active = call(root, ['memory', 'show', 'triage-problem'], MemoryLifecycleOutput).document;
 assert.equal(active.metadata.state, 'open');
 assert.deepEqual(active.metadata.history.at(-1), { action: 'activate', reason: 'Begin investigation' });
});
// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed create selects optional pages, keeps README required, and rejects invalid selections before writing', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('optional-pages');
 const only = call(root, ['feature', 'create', 'minimal', '--title', 'Minimal'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(only.changedPaths, ['docs/feature/minimal/README.md']);
 assert.doesNotMatch(readFileSync(join(root, only.changedPaths[0]!), 'utf8'), /\]\(/);
 call(root, ['feature', 'create', 'selected', '--title', 'Selected', '--pages', 'cli,library', '--pages', 'use-case'], Ack);
 const base = 'docs/feature/selected/';
 const readme = readFileSync(join(root, base, 'README.md'), 'utf8');
 for (const match of readme.matchAll(/\]\(([^)]+)\)/g)) assert.equal(existsSync(join(root, base, match[1]!)), true);
 assert.equal(existsSync(join(root, base, 'architecture.md')), false);
 assert.equal(existsSync(join(root, base, 'lifecycle.md')), false);
 assert.equal(call(root, ['use-case', 'list'], Schema.Struct({ documents: Schema.Array(Schema.Unknown) })).documents.length, 0);
 call(root, ['feature', 'page', 'add', 'selected', 'architecture'], Ack);
 assert.equal(readFileSync(join(root, base, 'README.md'), 'utf8'), readme);
 const author = '# Custom\n\nKeep [my link](custom.md).\n';
 call(root, ['feature', 'create', 'custom', '--title', 'Custom', '--body', '-', '--pages', 'cli'], Ack, author);
 const shown = call(root, ['feature', 'show', 'custom'], Schema.Struct({
   document: Schema.Struct({ path: Schema.String, metadata: Schema.Unknown, digest: Schema.String }),
   useCases: Schema.Array(Schema.Unknown), tests: Schema.Array(Schema.Unknown), codeDeclarations: Schema.Array(Schema.Unknown), findings: Schema.Array(Schema.Unknown),
 }));
 assert.equal(shown.document.path, 'docs/feature/custom/README.md');
 assert.deepEqual(shown.useCases, []);
 assert.equal('body' in shown.document, false, 'feature show leaves author prose to direct file reads');
 call(root, ['use-case', 'create', 'custom-flow', '--title', 'Custom flow', '--feature', 'custom'], Ack);
 const featureRelations = call(root, ['feature', 'show', 'custom'], Schema.Struct({ useCases: Schema.Array(Schema.Struct({ path: Schema.String })) }));
 assert.deepEqual(featureRelations.useCases.map(item => item.path), ['docs/feature/custom/use-case/custom-flow.md']);
 const useCaseRelations = call(root, ['use-case', 'show', 'custom-flow'], Schema.Struct({
   document: Schema.Struct({ path: Schema.String }), outgoing: Schema.Array(Schema.Struct({ to: Schema.String })),
 }));
 assert.equal(useCaseRelations.document.path, 'docs/feature/custom/use-case/custom-flow.md');
 assert.ok(useCaseRelations.outgoing.some(edge => edge.to === 'docs/feature/custom/README.md'));
 call(root, ['--dry-run', 'feature', 'create', 'preview', '--title', 'Preview', '--pages', 'cli'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/preview')), false);
 for (const [id, pages, error] of [['unknown', 'other', 'InvalidData'], ['duplicate', 'cli,cli', 'InvalidInput'], ['empty', 'cli,', 'InvalidData']] as const) {
   assert.equal(call(root, ['feature', 'create', id, '--title', id, '--pages', pages], ErrorOutput, '', 1).error, error);
   assert.equal(existsSync(join(root, 'docs/feature', id)), false);
 }
 assert.equal(call(root, ['engineering', 'create', 'invalid', '--title', 'Invalid', '--pages', 'cli'], ErrorOutput, '', 1).error, 'InvalidInput');
 assert.equal(existsSync(join(root, 'docs/engineering/invalid')), false);
 const engineering = call(root, ['engineering', 'create', 'small', '--title', 'Small'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(engineering.changedPaths, ['docs/engineering/small/README.md']);
 const engineeringShow = call(root, ['engineering', 'show', 'small'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }));
 assert.equal(engineeringShow.document.path, 'docs/engineering/small/README.md');
 assert.equal('body' in engineeringShow.document, false);
 write(root, 'docs/feature/conflict/cli.md', '# Existing\n');
 assert.equal(call(root, ['feature', 'create', 'conflict', '--title', 'Conflict', '--pages', 'cli'], ErrorOutput, '', 1).error, 'DocumentExists');
 assert.equal(existsSync(join(root, 'docs/feature/conflict/README.md')), false);
 assert.equal(readFileSync(join(root, 'docs/feature/conflict/cli.md'), 'utf8'), '# Existing\n');
 call(root, ['design', 'create', 'minimal-design', '--title', 'Design', '--alternative', 'one'], Ack);
 for (const file of ['README.md', 'GOALS.md', 'LIMITS.md', 'CASES.md', 'DECISION.md', 'plans/one/README.md']) assert.equal(existsSync(join(root, 'docs/design/minimal-design', file)), true);
 assert.equal(existsSync(join(root, 'docs/design/minimal-design/plans/one/cli.md')), false);
 call(root, ['roadmap', 'create', 'minimal-roadmap', '--title', 'Roadmap'], Ack);
 call(root, ['roadmap', 'adopt', 'minimal-roadmap', '--feature', 'adopted-minimal'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/adopted-minimal/README.md')), true);
 assert.equal(existsSync(join(root, 'docs/feature/adopted-minimal/cli.md')), false);
})));
function call<A>(root: string,args: readonly string[],schema: Schema.ConstraintDecoder<A, never>,input='Contract body.\n',status=0): A {
 const result=spawnSync(process.execPath,[cli,'--root',root,'--json',...args],{input,encoding:'utf8',timeout:20000});
 assert.equal(result.status,status,JSON.stringify({args,stdout:result.stdout,stderr:result.stderr,error:result.error}));
 return Schema.decodeUnknownSync(Schema.fromJsonString(schema), { onExcessProperty: 'ignore', errors: 'all' })(status===0||result.stdout.trim()?result.stdout:result.stderr);
}
function callString(root: string,args: readonly string[],input='Contract body.\n',status=0): string {
 return call(root, args, Schema.String, input, status);
}
function consumer(name: string){const root=join(scratch,name);mkdirSync(root);execFileSync('git',['init','-q',root]);call(root,['init'],Ack);return root;}
function write(root: string,path: string,source: string){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),source);}
// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('packed feedback commands persist connections and local triage without remote calls', () => Effect.runPromise(Effect.sync(() => {
 const root=consumer('packed-feedback');
 call(root,['feedback','connection','add','--id','github-main','--provider','github','--owner','example','--repo','demo','--credential-env','CONCORD_TEST_MISSING_TOKEN'],Ack);
 call(root,['feedback','connection','add','--id','linear-main','--provider','linear','--team','TEAM','--credential-env','CONCORD_TEST_MISSING_LINEAR_KEY'],Ack);
 const project=readProjectConfig(root);
 assert.deepEqual(project.feedbackConnections?.map(connection=>connection.provider),['github','linear']);
 call(root,['feature','create','feedback-target','--title','Feedback target'],Ack);
 call(root,['feedback','create','observation','--title','Local observation'],Ack);
 call(root,['feedback','link','observation','--feature','docs/feature/feedback-target/README.md'],Ack);
 const relative='docs/issues/observation.md';
 const linked=parseDocumentRecord(relative,readFileSync(join(root,relative),'utf8'));
 assert.equal(linked?.metadata.kind,'issue');
 if(linked?.metadata.kind!=='issue')assert.fail('feedback must retain the local issue owner');
 assert.deepEqual(linked.metadata.adoptions.current,['docs/feature/feedback-target/README.md']);
 assert.equal(linked.metadata.source,undefined);
 const listed=call(root,['feedback','list'],Schema.Unknown);
 assert.match(JSON.stringify(listed),/observation/);
 call(root,['feedback','show','observation'],Schema.Unknown);
 call(root,['feedback','close','observation','--reason','Investigation complete'],Ack);
 const closed=parseDocumentRecord(relative,readFileSync(join(root,relative),'utf8'));
 assert.equal(closed?.metadata.kind==='issue'&&closed.metadata.state,'closed');
 call(root,['feedback','connection','remove','github-main'],Ack);
 assert.ok(existsSync(join(root,relative)),'removing a connection must preserve local observations');
 assert.equal(call(root,['check'],CheckOutput).ok,true);
})));
// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('packed view serves its frontend and API without credentials in an isolated Git consumer', async () => {
 const root = consumer('packed-web');
 const process = spawn(globalThis.process.execPath, [cli, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
 const exited = once(process, 'exit');
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
  const shell=await fetch(base+'feature/accounts');
  assert.equal(shell.status,200);
  const html=await shell.text();
  assert.match(html,/<div id="root"><\/div>/);
  const script=/src="([^"]+\.js)"/.exec(html)?.[1]; assert.ok(script);
  const asset=await fetch(new URL(script,base)); assert.equal(asset.status,200);
  assert.match(asset.headers.get('content-type')??'',/javascript/);
  assert.ok((await asset.arrayBuffer()).byteLength > 0);
  const workspace=await fetch(base+'api/workspace');assert.equal(workspace.status,200);
  const response=Schema.decodeUnknownSync(Schema.Struct({ok:Schema.Boolean,value:Schema.Struct({root:Schema.String})}),{onExcessProperty:'ignore'})(await workspace.json());
  assert.equal(response.ok,true);assert.equal(response.value.root,root);
  assert.equal((await fetch(base+'api/missing')).status,404);
  assert.equal(call(root,['check'],CheckOutput).ok,true,'idle server must not lock out the CLI');
 } finally {process.kill('SIGTERM');await exited;}
});
// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed templates work outside a project and fail clearly when their inventory is damaged', () => Effect.runPromise(Effect.sync(() => {
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
 assert.match(readFileSync(join(root, 'docs/concord.md'), 'utf8'), /concord test list/);
 for (const path of ['docs/README.md', 'docs/_template/feature-design/lifecycle.md', 'docs/_template/roadmap/use-case/README.md', 'docs/_template/design-decision/CASES.md', 'docs/_template/design-decision/plans/plan-2/library.md', 'docs/_template/engineering/README.md', 'docs/concepts.md', 'docs/architecture.md', 'docs/_template/research/README.md', 'docs/_template/memory/problem.md']) assert.equal(existsSync(join(root, path)), true, path);
 assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /BEGIN CONCORD AGENT INSTRUCTIONS[\s\S]*concord trace gaps --json/u);
 call(root, ['feature', 'create', 'accounts', '--title', 'Accounts', '--pages', 'library,cli,architecture,lifecycle,use-case'], Ack);
 for (const page of ['README.md', 'library.md', 'cli.md', 'architecture.md', 'lifecycle.md', 'use-case/README.md']) assert.equal(existsSync(join(root, 'docs/feature/accounts', page)), true, page);
 call(root, ['feature', 'create', 'other', '--title', 'Other'], Ack);
 call(root, ['engineering', 'create', 'ci', '--title', 'Continuous integration'], Ack);
 const page = call(root, ['feature', 'page', 'show', 'accounts', 'cli'], DigestOutput);
 call(root, ['feature', 'page', 'set', 'accounts', 'cli', '--body', '-', '--expected-digest', page.digest], Ack, '# Accounts CLI\n\n## Sign in\n\nReject expired tokens.\n');
 assert.equal(call(root, ['feature', 'page', 'set', 'accounts', 'cli', '--body', '-', '--expected-digest', page.digest], ErrorOutput, '# Stale\n', 1).error, 'PreimageChanged');
 const ownerBefore = call(root, ['feature', 'show', 'accounts'], OwnerOutput).document;
 const readme = call(root, ['feature', 'page', 'show', 'accounts', 'readme'], PageOutput);
 assert.ok(!readme.body.startsWith('---'));
 call(root, ['feature', 'page', 'set', 'accounts', 'readme', '--body', '-', '--expected-digest', readme.digest], Ack, '# Accounts\n\nUsers sign in with valid credentials.\n');
 assert.deepEqual(call(root, ['feature', 'show', 'accounts'], OwnerOutput).document.metadata, ownerBefore.metadata);
 call(root, ['memory', 'add', 'expired', '--kind', 'problem', '--title', 'Expired token'], Ack);
 const annotation = call(root, ['test', 'annotate', '--contract', 'docs/feature/accounts/cli.md#sign-in', '--regression', 'memory/expired.md'], AnnotationOutput);
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
 write(root, 'bad-memory-sources.json', '{not json');
 assert.equal(call(root, ['init', '--memory-sources', join(root, 'bad-memory-sources.json')], ErrorOutput, '', 1).error, 'InvalidJson');
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 const runner = { kind: 'command', argv: ['node', '-e', 'require("node:fs").writeFileSync("EXECUTED", "bad")'], sourceFiles: [], timeoutMs: 1200 };
 write(root, 'runner.json', JSON.stringify(runner));
 const args = ['init', '--test-root', 'spec', '--runner-config', join(root, 'runner.json')];
 assert.equal(call(root, ['--dry-run', ...args], DryRunOutput).dryRun, true);
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 assert.deepEqual(readdirSync(join(root, '.git/concord')), ['trace']);
 assert.deepEqual(readdirSync(join(root, '.git/concord/trace')), []);
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
 call(root, ['engineering', 'create', 'release', '--title', 'Release'], Ack);
 call(root, ['design', 'create', 'storage', '--title', 'Storage', '--alternative', 'sqlite', '--alternative', 'files', '--pages', 'architecture'], Ack);
 assert.match(readFileSync(join(root, 'docs/design/storage/plans/sqlite/architecture.md'), 'utf8'), /Storage/);
 assert.equal(existsSync(join(root, 'docs/design/storage/GOALS.md')), true);
 const candidate = call(root, ['design', 'page', 'show', 'storage', 'readme', '--plan', 'sqlite'], DigestOutput);
 call(root, ['design', 'page', 'set', 'storage', 'readme', '--plan', 'sqlite', '--body', '-', '--expected-digest', candidate.digest], Ack, '# SQLite\n\nA single local store.\n');
 authorDesignFixture(root, 'storage', ['sqlite', 'files'], 'sqlite');
 call(root, ['design', 'decide', 'storage', '--selected', 'sqlite', '--target', 'docs/engineering/release/README.md', '--reason', 'One deployment owner'], Ack);
 const decision = call(root, ['design', 'show', 'storage'], DecisionOutput).document.metadata.decision;
 assert.equal(decision.selected, 'sqlite');
 call(root, ['roadmap', 'create', 'session', '--title', 'Session', '--pages', 'architecture'], Ack);
 call(root, ['roadmap', 'adopt', 'session', '--feature', 'session'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/session/architecture.md')), true);
 assert.equal(call(root, ['roadmap', 'show', 'session'], StateOutput).document.metadata.state, 'adopted');
 call(root, ['memory', 'add', 'release-owner', '--kind', 'decision', '--title', 'Release owner'], Ack);
 call(root, ['memory', 'promote', 'release-owner', '--target', 'docs/engineering/release/README.md'], Ack);
 assert.equal(call(root, ['test', 'annotate', '--contract', 'docs/engineering/release/README.md'], ErrorOutput, '', 1).error, 'InvalidReferenceTarget');
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
})));
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('installed CLI connects contracts, real red/green execution, Memory history and cache',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('flow');
 call(root,['feature','create','arithmetic','--title','Arithmetic','--body','-'],Ack);
 call(root,['use-case','create','addition','--feature','arithmetic','--title','Addition','--body','-'],Ack);
 call(root,['memory','add','sum-bug','--kind','problem','--title','Incorrect sum','--body','-'],Ack);
 write(root,'src/math.mjs','export const sum=(a,b)=>a-b;\n');
 write(root,'test/math.test.mjs',`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {sum} from '../src/math.mjs';\n// @use-case docs/feature/arithmetic/use-case/addition.md\n// @regression memory/sum-bug.md\ntest('adds numbers',()=>assert.equal(sum(2,3),5));\n`);
 const sumCase = deriveTestReference('test/math.test.mjs', 'test/math.test.mjs', caseDiscriminator('docs/feature/arithmetic/use-case/addition.md', 0));
 assert.equal(call(root,['check'],CheckOutput).ok,true);
 const red=call(root,['test','run',sumCase],EvidenceOutput,'',1);assert.equal(red.commandOutcome,'fail');assert.equal(red.execution,'nonzero');
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b;\n');
 const green=call(root,['test','run',sumCase],EvidenceOutput);assert.equal(green.commandOutcome,'pass');assert.equal(green.execution,'nonzero');
 const resolveArgs=['memory','resolve','sum-bug','--kind','fixed','--red',red.id,'--green',green.id,'--reason','Correct addition verified'];
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b+1;\n');
 assert.equal(call(root,resolveArgs,ErrorOutput,'',1).error,'EvidenceStale');
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b;\n');
 const originalTest=readFileSync(join(root,'test/math.test.mjs'),'utf8');
 write(root,'test/math.test.mjs',originalTest+'// changed test definition\n');
 assert.equal(call(root,resolveArgs,ErrorOutput,'',1).error,'EvidenceStale');
 write(root,'test/math.test.mjs',originalTest);
 call(root,resolveArgs,Ack);
 const memory=call(root,['memory','show','sum-bug'],ResolutionOutput).document;assert.equal(memory.metadata.state,'resolved');assert.equal(memory.metadata.resolution.evidenceLevel,'command');
 assert.equal(call(root,['trace','check'],CheckOutput).ok,true);assert.match(callString(root,['review','render']),/sum-bug/);
 call(root,['cache','clear'],Ack);assert.equal(call(root,['test','evidence',green.id],EvidenceOutput).id,green.id);
 call(root,['memory','reopen','sum-bug','--reason','New observation'],Ack);
 assert.equal(call(root,['memory','show','sum-bug'],EpochOutput).document.metadata.epoch,1);
 assert.equal(call(root,['memory','resolve','sum-bug','--kind','fixed','--red',red.id,'--green',green.id,'--reason','Old proof'],ErrorOutput,'',1).error,'EvidenceStale');
 const nested=spawnSync(process.execPath,[cli,'--json','feature','list'],{cwd:join(root,'src'),encoding:'utf8',timeout:10000});assert.equal(nested.status,0,nested.stderr);
})));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('installed CLI adoption moves current promotions atomically; local issue lifecycle stays explicit',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('lifecycle');
 call(root,['roadmap','create','sharing','--title','Sharing','--body','-'],Ack);
 call(root,['memory','add','sharing-rule','--kind','decision','--title','Sharing decision','--body','-'],Ack);
 call(root,['memory','promote','sharing-rule','--target','docs/roadmap/sharing/README.md'],Ack);
 call(root,['roadmap','adopt','sharing','--feature','sharing'],Ack);
 assert.deepEqual(call(root,['memory','show','sharing-rule'],PromotionsOutput).document.metadata.promotions,['docs/feature/sharing/README.md']);
 call(root,['issue','draft','observation','--title','Observation','--body','-'],Ack);
 call(root,['issue','link','observation','--memory','memory/sharing-rule.md'],Ack);
 call(root,['issue','close','observation','--reason','Decision adopted'],Ack);
 assert.equal(call(root,['check'],CheckOutput).ok,true);
 const source=readFileSync(join(root,'memory/sharing-rule.md'),'utf8');
 call(root,['--dry-run','memory','retire','sharing-rule','--target','docs/feature/sharing/README.md','--reason','Preview'],Ack);
 assert.equal(readFileSync(join(root,'memory/sharing-rule.md'),'utf8'),source);
})));
// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI returns a named failure for a known skipped declaration',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('skipped');
 call(root,['feature','create','skip-feature','--title','Skip feature','--body','-'],Ack);
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @feature docs/feature/skip-feature/README.md\n// @status retired\ntest.skip('skipped',()=>{});\n");
 write(root,'test/browser.test.ts',"// @feature docs/feature/skip-feature/README.md\ntest.describe('session', () => { test('fails closed', () => {}); });\n");
 const skippedCase = deriveTestReference('test/skipped.test.mjs', 'test/skipped.test.mjs', caseDiscriminator('docs/feature/skip-feature/README.md', 0));
 assert.equal(call(root,['check'],CheckOutput).ok,true);
 assert.equal(call(root,['test','run',skippedCase],ErrorOutput,'',1).error,'CaseNotRunnable');
})));
// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test('installed neutral governance keeps lifecycle rules and loads native hosts only for capability commands',()=>Effect.runPromise(Effect.sync(()=>{
 const root=join(scratch,'repository-profile');mkdirSync(root);execFileSync('git',['init','-q',root]);
 write(root,'package.json',JSON.stringify({private:true,type:'module'}));
 write(root,'concord.repository.json',JSON.stringify({format:'concord.repository/v2',host:'host.mjs',suites:[{id:'suite',root:'acceptance'}],historyPath:'acceptance-history.ts',policy:'concord.native-reliability/v1'}));
 const dependencyRoot=join(scratch,'tool/node_modules');
 symlinkSync(dependencyRoot,join(root,'node_modules'),'dir');
 const hostSource=`const forbidden=()=>{throw new Error('Native collection was not requested');};\nexport default {format:'concord.repository-host/v2',caseIdentity:'concord.case-contracts/v1',repositoryRoot:process.cwd(),collectRepoCaseInventory:forbidden,collectWorkspaceCaseInventory:forbidden,managedInventoryImplementationDigest:forbidden,readManagedInventoryReceipt:forbidden,readManagedRedEvidence:forbidden,readManagedTakeoverEvidence:forbidden};\n`;
 write(root,'host.mjs',hostSource);
 for(const directory of ['docs','acceptance','feedback','memory'])mkdirSync(join(root,directory));
 execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','Initialize fixture']);
 const profile=(args: readonly string[],input='A durable engineering observation.\n')=>spawnSync(process.execPath,[cli,'repo',...args],{cwd:root,input,encoding:'utf8',timeout:15000});
 let result=profile(['memory','add','profile-problem','--kind','problem','--title','Profile problem','--body','-','--json']);assert.equal(result.status,0,result.stderr+result.stdout);
 result=profile(['memory','resolve','profile-problem','--kind','fixed','--proof','ccev_0123456789abcdef0123456789abcdef','--json']);assert.notEqual(result.status,0,'command evidence must not close a formal Problem');
 result=profile(['memory','resolve','profile-problem','--kind','not-a-bug','--reason','Observed behavior matches the contract','--json']);assert.equal(result.status,0,result.stderr+result.stdout);
 result=profile(['memory','check','--json']);assert.equal(result.status,0,result.stderr+result.stdout);
 result=profile(['memory','add','profile-problem','--kind','problem','--title','Duplicate','--body','-','--json']);assert.notEqual(result.status,0);
 result=profile(['memory','list','--json']);assert.equal(result.status,0,'failed mutation must release its lock');
 write(root,'host.mjs',hostSource.replace('repositoryRoot:process.cwd()','repositoryRoot:'+JSON.stringify(scratch)));
 result=profile(['--help']);assert.equal(result.status,0,result.stderr);
 result=profile(['docs','test','inventory','--repo','suite','--json']);assert.notEqual(result.status,0);assert.match(result.stderr,/RepositoryHostMismatch/);
 write(root,'host.mjs',hostSource);
 rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
 const locked=join(root,'node_modules/concord-sdlc');cpSync(join(dependencyRoot,'concord-sdlc'),locked,{recursive:true});
 const identity=join(locked,'dist/evidence-policy.js');writeFileSync(identity,readFileSync(identity,'utf8')+'\n// different installed engine\n');
 result=profile(['--help']);assert.equal(result.status,0,result.stderr);
 result=profile(['docs','test','inventory','--repo','suite','--json']);assert.notEqual(result.status,0);assert.match(result.stderr,/RepositoryEngineMismatch/);
 rmSync(join(root,'concord.repository.json'));
 result=profile(['--help']);assert.equal(result.status,0,result.stderr);
 result=profile(['docs','test','inventory','--repo','suite','--json']);assert.notEqual(result.status,0);assert.match(result.stderr,/RepositoryProfileMissing|GovernanceConfigurationMissing/);
})));
// @use-case docs/feature/document-packages/use-case/organize-freeform-research.md
test('packed Research creates only its title and edits arbitrary nested supporting Markdown', () => {
 const root = consumer('research-package');
 const created = call(root, ['research', 'create', 'notes', '--title', 'My notes'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(created.changedPaths, ['docs/research/notes/README.md']);
 const owner = parseDocumentRecord('docs/research/notes/README.md', readFileSync(join(root, 'docs/research/notes/README.md'), 'utf8'))!;
 assert.equal(owner.body.trim(), '# My notes');
 call(root, ['research', 'page', 'add', 'notes', '材料/比较'], Ack);
 const page = call(root, ['research', 'page', 'show', 'notes', '材料/比较'], PageOutput);
 assert.equal(page.body.trim(), '# 比较');
 call(root, ['research', 'page', 'set', 'notes', '材料/比较', '--body', '-', '--expected-digest', page.digest], Ack, '# 任意结构\n\n自由正文。\n');
 assert.equal(readFileSync(join(root, 'docs/research/notes/材料/比较.md'), 'utf8'), '# 任意结构\n\n自由正文。\n');
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
});

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('packed writing checks consumer policy, readable prose, SVG, and safe input boundaries', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('writing');
 const reportSchema = Schema.Struct({ ok: Schema.Boolean, files: Schema.Int, findings: Schema.Array(Schema.Struct({ file: Schema.String, line: Schema.Int, rule: Schema.String, message: Schema.String })) });
 const policy = {
  format: 'concord.writing/v2', roots: ['guide', 'guide/page.md'],
  bannedTerms: [{ term: 'bad', use: 'clear', why: 'Be precise', exempt: ['guide/exempt'] }, { term: '旧词', use: '新词', why: 'One vocabulary', allowIn: ['旧词典'] }],
  sentenceLength: 20, paragraphLength: 30, unusedConcepts: true, svgTerms: true, svgStyle: 'guide/style.css',
 };
 mkdirSync(join(root, 'guide'));
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(policy));
 writeFileSync(join(root, 'guide/style.css'), '.label { fill: black; }\n');
 writeFileSync(join(root, 'docs/concepts.json'), JSON.stringify({ format: 'concord.concepts/v1', concepts: [{ id: 'new-word', definition: 'Preferred wording', names: { zh: { preferred: '新词', deprecated: ['旧称'] }, en: { preferred: 'Good' } } }] }));
 writeFileSync(join(root, 'guide/page.md'), [
  '---', 'title: bad', '---', '# Guide', '', '新词 good 旧词典.', '',
  '```ts', 'bad', '```', '', '~~~', 'bad', '~~~', '',
  '``bad ` bad`` [clear](bad) ![bad](image.png)', '', '<!-- bad -->', '',
  'bad BAD badly 旧词 旧称', '', '甲'.repeat(15), '乙'.repeat(20) + '。',
 ].join('\n'));
 writeFileSync(join(root, 'guide/view.mdx'), ['<Panel', ' title="bad"', '>', 'clear', '</Panel>', '{/* GENERATED:BEGIN fields */}', 'bad', '{/* GENERATED:END fields */}'].join('\n'));
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text><desc>bad</desc></svg>');
 const first = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert.equal(first.files, 3);
 assert(first.findings.filter(hit => hit.rule === 'bannedTerm').length >= 5);
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
 for (const rule of ['unusedConcept', 'svgTerm', 'svgStyle']) assert(missing.findings.some(hit => hit.rule === rule), rule);
 for (const invalid of [{ ...policy, unknown: true }, { ...policy, roots: ['../outside'] }, { ...policy, bannedTerms: [{ term: 'bad', use: '', why: 'reason' }] }]) {
  writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(invalid));
  assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 }
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ ...policy, roots: ['missing'] }));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'WritingInputNotFound');
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'UnsafePath');
 assert.equal(call(root, ['docs', 'check', '--rules', 'absent.json'], ErrorOutput, '', 1).error, 'WritingPolicyNotFound');
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed scoped owner commands use path, JSON body, null creation CAS, and standalone rules', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('scoped-owner-cli');
 write(root, 'docs/feature/sample/page.md', 'Feedback.\n');
 write(root, 'policy.json', JSON.stringify({ format: 'concord.writing/v2', bannedTerms: [] }));
 write(root, 'catalog.json', JSON.stringify({ format: 'concord.concepts/v1', concepts: [{ id: 'feedback', definition: 'A response', names: { en: { preferred: 'Feedback' }, api: { preferred: 'Feedback' } } }] }));
 const ownerPath = 'docs/feature/sample/concord-writing.json';
 const catalogPath = 'docs/feature/sample/concepts.json';
 assert.equal(call(root, ['writing', 'show', '--path', ownerPath], Schema.Struct({ state: Schema.String })).state, 'missing');
 assert.equal(call(root, ['--dry-run', 'writing', 'set', '--path', ownerPath, '--body', join(root, 'policy.json'), '--expected-digest', 'null'], DryRunOutput).dryRun, true);
 assert.equal(existsSync(join(root, ownerPath)), false);
 call(root, ['writing', 'set', '--path', ownerPath, '--body', join(root, 'policy.json'), '--expected-digest', 'null'], DigestOutput);
 call(root, ['concepts', 'set', '--path', catalogPath, '--body', join(root, 'catalog.json'), '--expected-digest', 'null'], DigestOutput);
 assert.equal(call(root, ['concepts', 'show', '--path', catalogPath], Schema.Struct({ state: Schema.String })).state, 'valid');
 assert(call(root, ['writing', 'index'], Schema.Struct({ scopes: Schema.Array(Schema.Struct({ scope: Schema.String })) })).scopes.some(item => item.scope === 'docs/feature/sample'));
 assert(call(root, ['concepts', 'index'], Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String })) })).concepts.some(item => item.reference === catalogPath + '#feedback'));
 assert.equal(call(root, ['writing', 'check', '--path', ownerPath], CheckOutput).ok, true);
 const external = consumer('standalone-owner-cli');
 rmSync(join(external, 'docs/concepts.json'));
 write(external, 'guide/page.md', 'Standalone prose.\n');
 write(external, 'rules.json', JSON.stringify({ format: 'concord.writing/v2', roots: ['guide'], bannedTerms: [] }));
 assert.equal(call(external, ['docs', 'check', '--rules', 'rules.json'], CheckOutput).ok, true);
 write(external, 'docs/concord-writing.json', JSON.stringify({ format: 'concord.writing/v1', roots: ['docs'], bannedTerms: [] }));
 assert.equal(call(external, ['docs', 'check', '--rules', 'rules.json'], CheckOutput).ok, true);
})));
