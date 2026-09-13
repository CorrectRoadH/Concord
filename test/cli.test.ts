import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { Effect, Schema } from 'effect';
import { ProjectSchema } from '../dist/shared.js';
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
// @concord-case installed-template-inventory
// @concord-contract docs/feature/local-sdlc/use-case/onboard-from-template.md
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
// @concord-case installed-trace-and-review
// @concord-contract docs/feature/local-sdlc/use-case/review-traceability.md
test('installed onboarding creates editable packages and connects supporting-page tests to their Feature', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('onboarding');
 assert.match(readFileSync(join(root, 'docs/concord.md'), 'utf8'), /concord test annotate/);
 for (const path of ['docs/README.md', 'docs/_template/feature-design/lifecycle.md', 'docs/_template/roadmap/use-case/README.md', 'docs/_template/design-decision/CASES.md', 'docs/_template/design-decision/plans/plan-2/library.md', 'docs/_template/engineering/architecture.md', 'docs/_template/research/README.md', 'docs/_template/memory/problem.md']) assert.equal(existsSync(join(root, path)), true, path);
 assert.equal(existsSync(join(root, 'AGENTS.md')), false);
 call(root, ['feature', 'create', 'accounts', '--title', 'Accounts'], Ack);
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
 const annotation = call(root, ['test', 'annotate', 'reject-expired', '--contract', 'docs/feature/accounts/cli.md#sign-in', '--regression', 'memory/expired.md'], AnnotationOutput);
 assert.equal(existsSync(join(root, 'test')), false, 'annotate must not edit test sources');
 write(root, 'test/accounts.test.mjs', `import test from 'node:test';\n${annotation.snippet}test('rejects expired tokens', () => {});\n`);
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
 const tracedTest = call(root, ['trace', 'show', 'accounts'], TraceOutput).tests[0];
 assert.ok(tracedTest);
 assert.equal(tracedTest.id, 'reject-expired');
 assert.equal(call(root, ['trace', 'show', 'other'], TraceOutput).tests.length, 0);
 assert.match(callString(root, ['review', 'render', 'accounts']), /reject-expired/);
 assert.equal(call(root, ['test', 'annotate', 'reject-expired', '--contract', 'docs/feature/accounts/README.md'], ErrorOutput, '', 1).error, 'CaseExists');
 assert.equal(call(root, ['doctor'], DoctorOutput).cases, 1);
 const human = spawnSync(process.execPath, [cli, '--root', root, 'test', 'list'], { encoding: 'utf8' });
 assert.equal(human.status, 0, human.stderr);
 assert.match(human.stdout, /reject-expired/);
 assert.match(human.stdout, /Contract:/);
 assert.ok(!human.stdout.trimStart().startsWith('{'));
})));
// @concord-case installed-init-is-safe
// @concord-contract docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed init previews configuration, preserves existing docs, and never runs the configured command', () => Effect.runPromise(Effect.sync(() => {
 const root = join(scratch, 'init-options'); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
 write(root, 'docs/README.md', '# Existing documentation\n');
 const runner = { kind: 'command', argv: ['node', '-e', 'require("node:fs").writeFileSync("EXECUTED", "bad")'], sourceFiles: [], timeoutMs: 1200 };
 write(root, 'runner.json', JSON.stringify(runner));
 const args = ['init', '--test-root', 'spec', '--runner-config', join(root, 'runner.json')];
 assert.equal(call(root, ['--dry-run', ...args], DryRunOutput).dryRun, true);
 assert.equal(existsSync(join(root, 'concord.json')), false);
 assert.equal(existsSync(join(root, '.git/concord')), false);
 call(root, args, Ack);
 const config = Schema.decodeUnknownSync(Schema.fromJsonString(ProjectSchema))(readFileSync(join(root, 'concord.json'), 'utf8'));
 assert.deepEqual(config.testRoots, ['spec']); assert.deepEqual(config.runner, runner);
 assert.equal(readFileSync(join(root, 'docs/README.md'), 'utf8'), '# Existing documentation\n');
 const diagnosis = call(root, ['doctor'], DoctorOutput);
 assert.deepEqual(diagnosis.missingTestRoots, ['spec']);
 call(root, ['check'], CheckOutput);
 assert.equal(existsSync(join(root, 'EXECUTED')), false);
 assert.equal(call(root, ['init'], ErrorOutput, '', 1).error, 'ProjectExists');
})));
// @concord-case installed-document-lifecycles
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('installed Design and Roadmap packages retain their pages and authoritative lifecycle metadata', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('document-packages');
 call(root, ['engineering', 'create', 'release', '--title', 'Release'], Ack);
 call(root, ['design', 'create', 'storage', '--title', 'Storage', '--alternative', 'sqlite', '--alternative', 'files'], Ack);
 assert.match(readFileSync(join(root, 'docs/design/storage/plans/sqlite/architecture.md'), 'utf8'), /Storage/);
 assert.equal(existsSync(join(root, 'docs/design/storage/GOALS.md')), true);
 const candidate = call(root, ['design', 'page', 'show', 'storage', 'readme', '--plan', 'sqlite'], DigestOutput);
 call(root, ['design', 'page', 'set', 'storage', 'readme', '--plan', 'sqlite', '--body', '-', '--expected-digest', candidate.digest], Ack, '# SQLite\n\nA single local store.\n');
 call(root, ['design', 'decide', 'storage', '--selected', 'sqlite', '--target', 'docs/engineering/release/README.md', '--reason', 'One deployment owner'], Ack);
 const decision = call(root, ['design', 'show', 'storage'], DecisionOutput).document.metadata.decision;
 assert.equal(decision.selected, 'sqlite');
 call(root, ['roadmap', 'create', 'session', '--title', 'Session'], Ack);
 call(root, ['roadmap', 'adopt', 'session', '--feature', 'session'], Ack);
 assert.equal(existsSync(join(root, 'docs/feature/session/architecture.md')), true);
 assert.equal(call(root, ['roadmap', 'show', 'session'], StateOutput).document.metadata.state, 'adopted');
 call(root, ['memory', 'add', 'release-owner', '--kind', 'decision', '--title', 'Release owner'], Ack);
 call(root, ['memory', 'promote', 'release-owner', '--target', 'docs/engineering/release/README.md'], Ack);
 assert.equal(call(root, ['test', 'annotate', 'release-case', '--contract', 'docs/engineering/release/README.md'], ErrorOutput, '', 1).error, 'InvalidReferenceTarget');
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
})));
// @concord-case installed-command-evidence-memory
// @concord-contract docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('installed CLI connects contracts, real red/green execution, Memory history and cache',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('flow');
 call(root,['feature','create','arithmetic','--title','Arithmetic','--body','-'],Ack);
 call(root,['use-case','create','addition','--feature','arithmetic','--title','Addition','--body','-'],Ack);
 call(root,['memory','add','sum-bug','--kind','problem','--title','Incorrect sum','--body','-'],Ack);
 write(root,'src/math.mjs','export const sum=(a,b)=>a-b;\n');
 write(root,'test/math.test.mjs',`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {sum} from '../src/math.mjs';\n// @concord-case sum-adds\n// @concord-contract docs/feature/arithmetic/use-case/addition.md\n// @concord-regression memory/sum-bug.md\ntest('adds numbers',()=>assert.equal(sum(2,3),5));\n`);
 assert.equal(call(root,['check'],CheckOutput).ok,true);
 const red=call(root,['test','run','sum-adds'],EvidenceOutput,'',1);assert.equal(red.commandOutcome,'fail');assert.equal(red.execution,'nonzero');
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b;\n');
 const green=call(root,['test','run','sum-adds'],EvidenceOutput);assert.equal(green.commandOutcome,'pass');assert.equal(green.execution,'nonzero');
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
// @concord-case installed-adoption-and-issue-lifecycle
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
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
// @concord-case installed-rejects-skipped-case
// @concord-contract docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI returns a named failure for a known skipped declaration',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('skipped');
 call(root,['feature','create','skip-feature','--title','Skip feature','--body','-'],Ack);
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @concord-case skipped-case\n// @concord-contract docs/feature/skip-feature/README.md\ntest.skip('skipped',()=>{});\n");
 assert.equal(call(root,['test','run','skipped-case'],ErrorOutput,'',1).error,'CaseNotRunnable');
})));
// @concord-case repository-profile-compatibility
// @concord-contract docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test('installed repository profile keeps lifecycle behavior and refuses mismatched hosts or engines',()=>Effect.runPromise(Effect.sync(()=>{
 const root=join(scratch,'repository-profile');mkdirSync(root);execFileSync('git',['init','-q',root]);
 write(root,'package.json',JSON.stringify({private:true,type:'module'}));
 write(root,'concord.repository.json',JSON.stringify({format:'concord.repository/v1',host:'host.mjs'}));
 const dependencyRoot=join(scratch,'tool/node_modules');
 symlinkSync(dependencyRoot,join(root,'node_modules'),'dir');
 const hostSource=`import {Layer} from 'effect';\nconst forbidden=()=>{throw new Error('Native collection was not requested');};\nexport default {format:'concord.repository-host/v1',repositoryRoot:process.cwd(),QUERY_PROTOCOL:'niceeval.query/v1',OwnedProcessLive:Layer.empty,collectRepoCaseInventory:forbidden,collectWorkspaceCaseInventory:forbidden,managedInventoryImplementationDigest:forbidden,readManagedInventoryReceipt:forbidden,readManagedRedEvidence:forbidden,readManagedTakeoverEvidence:forbidden};\n`;
 write(root,'host.mjs',hostSource);
 for(const directory of ['docs','e2e','feedback','memory'])mkdirSync(join(root,directory));
 execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','Initialize fixture']);
 const profile=(args: readonly string[],input='A durable engineering observation.\n')=>spawnSync(process.execPath,[cli,'repo',...args],{cwd:root,input,encoding:'utf8',timeout:15000});
 let result=profile(['memory','add','profile-problem','--kind','problem','--title','Profile problem','--body','-','--json']);assert.equal(result.status,0,result.stderr+result.stdout);
 result=profile(['memory','resolve','profile-problem','--kind','fixed','--proof','ccev_0123456789abcdef0123456789abcdef','--json']);assert.notEqual(result.status,0,'command evidence must not close a formal Problem');
 result=profile(['memory','resolve','profile-problem','--kind','not-a-bug','--proof','Observed behavior matches the contract','--json']);assert.equal(result.status,0,result.stderr+result.stdout);
 result=profile(['memory','check','--json']);assert.equal(result.status,0,result.stderr+result.stdout);
 result=profile(['memory','add','profile-problem','--kind','problem','--title','Duplicate','--body','-','--json']);assert.notEqual(result.status,0);
 result=profile(['memory','list','--json']);assert.equal(result.status,0,'failed mutation must release its lock');
 write(root,'host.mjs',hostSource.replace('repositoryRoot:process.cwd()','repositoryRoot:'+JSON.stringify(scratch)));
 result=profile(['--help']);assert.notEqual(result.status,0);assert.match(result.stderr,/RepositoryHostMismatch/);
 write(root,'host.mjs',hostSource);
 rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
 const locked=join(root,'node_modules/concord-sdlc');cpSync(join(dependencyRoot,'concord-sdlc'),locked,{recursive:true});
 const identity=join(locked,'dist/repository/identity.js');writeFileSync(identity,readFileSync(identity,'utf8')+'\n// different installed engine\n');
 result=profile(['--help']);assert.notEqual(result.status,0);assert.match(result.stderr,/RepositoryEngineMismatch/);
 rmSync(join(root,'concord.repository.json'));
 result=profile(['--help']);assert.notEqual(result.status,0);assert.match(result.stderr,/RepositoryProfileMissing/);
})));
