import { packConcord, installConcord } from './installed-package.js';
// @concord-file
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { makeOwnedProcessService } from '../src/owned-process.js';
import { initialize, LocalRepository } from '../src/storage.js';
import { setConfig, showConfig } from '../src/editing.js';

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('owned process transports stdin and preserves default ignored stdin', async () => {
  const processService = makeOwnedProcessService();
  const input = '@a local path\n你好';
  const result = await Effect.runPromise(Effect.scoped(processService.run([process.execPath, '-e', "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>process.stdout.write(s))"], { cwd: tmpdir(), stdin: input })));
  assert.equal(result.stdout, input);
  assert.equal(result.exitCode, 0);
  assert.equal(result.groupCleanup.gone, process.platform === 'win32' ? null : true);
  const ignored = await Effect.runPromise(Effect.scoped(processService.run([process.execPath, '-e', "process.stdin.on('end',()=>process.stdout.write('EOF'));process.stdin.resume()"], { cwd: tmpdir() })));
  assert.equal(ignored.stdout, 'EOF');
});

interface Call { readonly args: readonly string[]; readonly stdin: string; readonly env: Readonly<Record<string, unknown>> }
interface Receipt { readonly receiptId: string; readonly authorize: string; readonly payloadDigest: string; readonly expiresAt: string; readonly target: string }
const connection = { id: 'product-gh', provider: 'github', transport: 'gh', owner: 'example', repo: 'product', repositoryId: '42' } as const;
const issue = (number = 12, extra: Readonly<Record<string, unknown>> = {}) => ({ number, html_url: `https://github.com/example/product/issues/${number}`, title: 'Planned title', body: 'initial', state: 'open', labels: [{ name: 'old' }], ...extra });
const scratch = mkdtempSync(join(tmpdir(), 'concord-issue-remote-'));
const bin = join(scratch, 'bin');
const scenarioFile = join(scratch, 'scenario.json');
const callsFile = join(scratch, 'calls.ndjson');
mkdirSync(bin);
// JavaScript consumer fixture models the gh executable boundary only.
writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs=require('node:fs');
const scenarioPath=${JSON.stringify(scenarioFile)};
const callsPath=${JSON.stringify(callsFile)};
const mode=JSON.parse(fs.readFileSync(scenarioPath,'utf8'));
const args=process.argv.slice(2);
let input='';
const finish=()=>{
fs.appendFileSync(callsPath,JSON.stringify({args,stdin:input,env:{GH_DEBUG:process.env.GH_DEBUG,GH_REPO:process.env.GH_REPO,GH_PROMPT_DISABLED:process.env.GH_PROMPT_DISABLED}})+'\\n');
if(args[0]==='--version'){console.log('gh version 2.98.0 (fixture)');return;}
if(args[1]==='--help'){console.log('--hostname --method --include --input');return;}
const method=args[args.indexOf('--method')+1];const path=args.at(-1);
const isWrite=method!=='GET';
let body;let status=200;
if(mode.oversize&&!isWrite){process.stdout.write('x'.repeat(3*1024*1024));return;}
if(path==='repos/example/product')body={id:mode.repositoryId||42,full_name:'example/product'};
else if(path.includes('/issues?')){
const params=new URL('https://api.github.com/'+path).searchParams;
body=mode.pages?Array.from({length:100},(_,i)=>({...mode.issue,number:(Number(params.get('page'))-1)*100+i+1,html_url:'https://github.com/example/product/issues/'+((Number(params.get('page'))-1)*100+i+1)})):(mode.list||[]).filter(i=>i.state===params.get('state'));
}else if(!isWrite)body=mode.issue;
else {
const payload=JSON.parse(input||'{}');
if(mode.reject){status=mode.reject;body={message:'rejected'};}
else if(method==='PATCH'){mode.issue={...mode.issue,...payload};body=mode.issue;}
else if(path.endsWith('/labels')&&method==='POST'){mode.issue.labels=[...new Set([...mode.issue.labels.map(i=>i.name),...payload.labels])].map(name=>({name}));body=mode.issue.labels;}
else if(method==='DELETE'){const label=decodeURIComponent(path.split('/').at(-1));mode.issue.labels=mode.issue.labels.filter(i=>i.name!==label);body=mode.issue.labels;}
else if(path.endsWith('/comments'))body={id:1,body:payload.body};
else{body={...mode.issue,number:99,html_url:'https://github.com/example/product/issues/99',...payload};mode.list=[...(mode.list||[]),body];}
fs.writeFileSync(scenarioPath,JSON.stringify(mode));
if(mode.hangWrite){setInterval(()=>{},1000);return;}
if(mode.signalWrite){process.kill(process.pid,'SIGTERM');return;}
if(mode.invalidWrite){console.log('invalid response');return;}
}
process.stdout.write('HTTP/2 '+status+' OK\\r\\ncontent-type: application/json\\r\\n\\r\\n'+JSON.stringify(body));process.exitCode=status>=400?1:0;
};
if(args.includes('--input')){process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',finish);}else finish();
`, { mode: 0o755 });
let packedCli: string;
test.before(() => Effect.runPromise(Effect.sync(() => {
  const packed = packConcord(scratch);
  const tool = join(scratch, 'tool'); mkdirSync(tool); writeFileSync(join(tool, 'package.json'), '{"private":true}');
  installConcord(tool, packed);
  packedCli = join(tool, 'node_modules/concord-sdlc/dist/entry.js');
})));
test.after(() => { rmSync(scratch, { recursive: true, force: true }); });
function consumer(name: string, selected: unknown = connection): string {
  const root = join(scratch, name); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true }); try { initialize(initial); } finally { initial.close(); }
  const repository = new LocalRepository(root);
  try { const config = showConfig(repository); setConfig(repository, { ...config.config, feedbackConnections: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))([selected]) as typeof config.config.feedbackConnections }, config.digest); }
  finally { repository.close(); }
  return root;
}
function mode(extra: Readonly<Record<string, unknown>> = {}) { writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [], ...extra })); writeFileSync(callsFile, ''); }
function calls(): readonly Call[] { return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(source => JSON.parse(source) as Call); }
function writes(): readonly Call[] { return calls().filter(call => call.args.includes('--method') && call.args[call.args.indexOf('--method') + 1] !== 'GET'); }
function cli(root: string, args: readonly string[], timeout = 150_000) {
  return spawnSync(process.execPath, [packedCli, '--root', root, 'issue', ...args, '--json'], { cwd: root, encoding: 'utf8', timeout, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, GH_DEBUG: 'api', GH_REPO: 'attacker/other' } });
}
function plan(root: string, operation: string, args: readonly string[] = ['12']): Receipt {
  const result = cli(root, ['plan', operation, ...args, '--connection', connection.id]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout) as Receipt;
  assert.equal(writes().length, 0);
  assert.match(receipt.authorize, new RegExp(`^${operation}:example/product(?:#12)?@[a-f0-9]{12}$`));
  assert.equal(receipt.authorize.split('@')[1], receipt.payloadDigest.slice(7, 19));
  assert.equal(statSync(join(root, '.git/concord/issue-plan/v1/planned', `${receipt.receiptId}.json`)).mode & 0o777, 0o600);
  return receipt;
}
function execute(root: string, receipt: Receipt, authorization = receipt.authorize, selected: string = connection.id) { return cli(root, ['execute', receipt.receiptId, '--connection', selected, '--authorize', authorization]); }
function error(result: ReturnType<typeof cli>, code: string | readonly string[]) { assert.equal(result.status, 1, result.stdout); const actual = (JSON.parse(result.stderr) as { error: string }).error; if (typeof code === 'string') assert.equal(actual, code, result.stderr); else assert.ok(code.includes(actual), result.stderr); }
function alterReceipt(root: string, receipt: Receipt, patch: Readonly<Record<string, unknown>>) {
  const path = join(root, '.git/concord/issue-plan/v1/planned', `${receipt.receiptId}.json`);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')) as object, ...patch }));
}

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed plan/execute binds authorization, consumes once, uses stdin and emits private outcome', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('authorization'); mode();
  const receipt = plan(root, 'close', ['12', '--reason', 'completed']);
  const before = calls().length;
  error(execute(root, receipt, 'close:example/product#12@000000000000'), 'IssueAuthorizationMismatch');
  assert.equal(calls().length, before, 'authorization mismatch must not invoke gh');
  error(execute(root, receipt, 'close:example/product#12'), 'IssueAuthorizationMismatch');
  const result = execute(root, receipt); assert.equal(result.status, 0, result.stderr);
  assert.equal(writes().length, 1); assert.deepEqual(JSON.parse(writes()[0]!.stdin), { state: 'closed', state_reason: 'completed' });
  assert.ok(writes()[0]!.args.includes('--input')); assert.ok(!writes()[0]!.args.some(arg => ['-f', '-F', '--field', '--raw-field'].includes(arg)));
  assert.ok(calls().every(call => call.env.GH_REPO === undefined && call.env.GH_DEBUG === undefined));
  const outcome = join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`);
  assert.equal((JSON.parse(readFileSync(outcome, 'utf8')) as { state: string }).state, 'applied'); assert.equal(statSync(outcome).mode & 0o777, 0o600);
  error(execute(root, receipt), 'IssuePlanConsumed'); assert.equal(writes().length, 1);
  error(cli(root, ['plan', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed execute rejects expired, drifted, corrupt and wrong repository plans without writes', () => Effect.runPromise(Effect.sync(() => {
  for (const variant of ['expired', 'drifted', 'repository', 'corrupt']) {
    const root = consumer(variant); mode(); const receipt = plan(root, 'close');
    if (variant === 'expired') alterReceipt(root, receipt, { expiresAt: 0 });
    if (variant === 'corrupt') alterReceipt(root, receipt, { unknown: true });
    if (variant === 'drifted') writeFileSync(scenarioFile, JSON.stringify({ issue: issue(12, { body: 'changed' }) }));
    if (variant === 'repository') writeFileSync(scenarioFile, JSON.stringify({ repositoryId: 999, issue: issue() }));
    error(execute(root, receipt), { expired: 'IssuePlanExpired', drifted: 'IssuePlanDrifted', repository: 'ConnectionIdentityMismatch', corrupt: 'IssuePlanCorrupt' }[variant]!);
    assert.equal(writes().length, 0);
    if (variant === 'repository') { const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string; code: string }; assert.equal(outcome.state, 'aborted'); assert.equal(outcome.code, 'ConnectionIdentityMismatch'); }
    if (variant === 'drifted') assert.equal((JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string }).state, 'drifted');
  }
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed plans reject PR, unbound/API connections, no change, invalid labels and output/page budgets', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('reject-plans');
  for (const [extra, args, code] of [
    [{ issue: issue(12, { pull_request: {}, html_url: 'https://github.com/example/product/pull/12' }) }, ['close', '12'], 'IssueTargetIsPullRequest'],
    [{ issue: issue(12, { state: 'closed' }) }, ['close', '12'], 'IssueNoChange'],
    [{}, ['reopen', '12'], 'IssueNoChange'],
    [{}, ['labels-add', '12', '--label', 'old'], 'IssueNoChange'],
    [{}, ['labels-remove', '12', '--label', 'missing'], 'IssueNoChange'],
    [{}, ['labels-add', '12', '--label', 'x'.repeat(51)], 'InvalidInput'],
    [{}, ['labels-add', '12', '--label', 'bad\nlabel'], 'InvalidInput'],
    [{}, ['labels-remove', '12', '--label', 'old', '--label', 'other'], 'InvalidInput'],
    [{ oversize: true }, ['close', '12'], 'IssueRemoteBudgetExceeded'],
    [{ pages: true, issue: issue(12, { body: 'x'.repeat(16000) }) }, ['create', '--title', 'x', '--body', join(root, 'body.txt')], ['IssueRemoteBudgetExceeded', 'GhTimeout']],
    [{ pages: true }, ['create', '--title', 'x', '--body', join(root, 'body.txt')], ['IssueRemoteBudgetExceeded', 'GhTimeout']],
  ] as const) {
    writeFileSync(join(root, 'body.txt'), 'body'); mode(extra); error(cli(root, ['plan', ...args, '--connection', connection.id]), code); assert.equal(writes().length, 0);
  }
  assert.equal(existsSync(join(root, '.git/concord/issue-plan/v1/planned')), false, 'failed plan must not sign a receipt');
  const unbound = consumer('unbound', { ...connection, repositoryId: undefined }); mode(); error(cli(unbound, ['plan', 'close', '12', '--connection', connection.id]), 'IssueConnectionUnbound'); assert.equal(calls().length, 0);
  const api = consumer('api', { ...connection, transport: 'api', credentialEnv: 'TEST_TOKEN' }); mode(); error(cli(api, ['plan', 'close', '12', '--connection', connection.id]), 'IssueRemoteTransportUnsupported'); assert.equal(calls().length, 0);
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed writes fix PATCH fields, encode labels, retain literal @ bodies and re-plan no change', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('operations'); const body = join(root, 'body.txt'); writeFileSync(body, '@secret-path\n你好');
  for (const [operation, args, expected] of [
    ['body-set', ['12', '--body', body], { body: '@secret-path\n你好' }],
    ['comment-add', ['12', '--body', body], { body: '@secret-path\n你好' }],
    ['labels-add', ['12', '--label', '@x', '--label', 'slash/a b'], { labels: ['@x', 'slash/a b'] }],
    ['labels-remove', ['12', '--label', 'slash/a b'], {}],
    ['reopen', ['12'], { state: 'open' }],
  ] as const) {
    mode({ issue: issue(12, operation === 'reopen' ? { state: 'closed' } : operation === 'labels-remove' ? { labels: [{ name: 'slash/a b' }] } : {}) });
    const receipt = plan(root, operation, args); assert.equal(execute(root, receipt).status, 0);
    assert.equal(writes().length, 1); assert.deepEqual(JSON.parse(writes()[0]!.stdin), expected);
    if (operation === 'labels-remove') assert.equal(writes()[0]!.args.at(-1), 'repos/example/product/issues/12/labels/slash%2Fa%20b');
    if (operation !== 'comment-add') error(cli(root, ['plan', operation, ...args, '--connection', connection.id]), 'IssueNoChange');
  }
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed create scans both states, narrows preimage and checks machine origin conflicts', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('create'); const body = join(root, 'body.txt'); writeFileSync(body, 'manual body'); mode({ list: [issue(2, { title: 'other' })] });
  const receipt = plan(root, 'create', ['--title', 'Planned title', '--body', body]);
  writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [issue(2, { title: 'changed unrelated' })] }));
  assert.equal(execute(root, receipt).status, 0); assert.equal(writes().length, 1);
  mode(); const sameTitle = plan(root, 'create', ['--title', 'Planned title', '--body', body]); writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [issue(5)] })); error(execute(root, sameTitle), 'IssuePlanDrifted'); assert.equal(writes().length, 0);
  const machineBody = `origin-key: machine.1\npayload-sha256: ${'a'.repeat(64)}\n`; writeFileSync(body, machineBody); mode({ list: [issue(3, { body: machineBody, state: 'closed' })] });
  error(cli(root, ['plan', 'create', '--title', 'x', '--body', body, '--origin-key', 'machine.1', '--connection', connection.id]), 'IssueCreateConflict'); assert.equal(writes().length, 0);
  mode({ list: [issue(3, { body: 'unrelated', state: 'closed' })] }); const machine = plan(root, 'create', ['--title', 'x', '--body', body, '--origin-key', 'machine.1']);
  writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [issue(3, { body: 'changed unrelated', state: 'closed' })] })); assert.equal(execute(root, machine).status, 0);
  error(cli(root, ['plan', 'create', '--title', 'x', '--body', body, '--origin-key', 'machine.1', '--connection', connection.id]), 'IssueCreateConflict');
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed rejected and uncertain writes remain consumed and are never retried', () => Effect.runPromise(Effect.sync(() => {
  for (const kind of ['reject', 'invalidWrite', 'signalWrite']) {
    const root = consumer(`write-${kind}`); mode({ [kind]: kind === 'reject' ? 403 : true }); const receipt = plan(root, 'close'); const result = execute(root, receipt);
    error(result, kind === 'reject' ? 'IssueRemoteRejected' : 'IssueMutationUncertain'); assert.equal(writes().length, 1);
    const details = (JSON.parse(result.stderr) as { details: Readonly<Record<string, unknown>> }).details;
    if (kind === 'reject') { assert.equal(details.status, 403); const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string; status: number }; assert.equal(outcome.state, 'rejected'); assert.equal(outcome.status, 403); }
    else { assert.equal(details.receiptId, receipt.receiptId); assert.equal(details.method, 'PATCH'); assert.equal(details.path, 'repos/example/product/issues/12'); assert.equal((JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string }).state, 'uncertain'); }
    error(execute(root, receipt), 'IssuePlanConsumed'); assert.equal(writes().length, 1);
    if (kind !== 'reject') error(cli(root, ['plan', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
  }
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed write deadline produces uncertain outcome and a fresh close observes applied state', { skip: process.platform === 'win32', timeout: 240_000 }, () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('write-timeout'); mode({ hangWrite: true }); const receipt = plan(root, 'close');
  error(execute(root, receipt), 'IssueMutationUncertain'); assert.equal(writes().length, 1);
  error(cli(root, ['plan', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
})));


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed execute aborts on read budgets and preserves rejection when outcome publication fails', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('outcome-errors'); mode(); const receipt = plan(root, 'close');
  writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), oversize: true }));
  error(execute(root, receipt), 'IssueRemoteBudgetExceeded'); assert.equal(writes().length, 0);
  const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string; code: string };
  assert.deepEqual({ state: outcome.state, code: outcome.code }, { state: 'aborted', code: 'IssueRemoteBudgetExceeded' });
  mode({ reject: 500 }); const rejected = plan(root, 'close');
  mkdirSync(join(root, '.git/concord/issue-plan/v1/consumed', `${rejected.receiptId}.outcome.json`));
  error(execute(root, rejected), 'IssueRemoteRejected'); assert.equal(writes().length, 1);
  error(execute(root, rejected), 'IssuePlanConsumed');
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed execute rejects another connection and another payload authorization before gh calls', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('binding'); mode();
  const repository = new LocalRepository(root);
  try { const config = showConfig(repository); setConfig(repository, { ...config.config, feedbackConnections: [connection, { ...connection, id: 'alias-gh' }] }, config.digest); } finally { repository.close(); }
  const body = join(root, 'body.txt'); writeFileSync(body, 'first');
  const first = plan(root, 'body-set', ['12', '--body', body]); writeFileSync(body, 'second');
  const second = plan(root, 'body-set', ['12', '--body', body]);
  const before = calls().length;
  error(execute(root, first, second.authorize), 'IssueAuthorizationMismatch');
  error(execute(root, first, first.authorize, 'alias-gh'), 'IssueAuthorizationMismatch');
  assert.equal(calls().length, before); assert.equal(writes().length, 0);
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed concurrent execute consumes the receipt exactly once across processes', async () => {
  const root = consumer('concurrent'); mode(); const receipt = plan(root, 'close');
  const service = makeOwnedProcessService();
  const argv = [process.execPath, packedCli, '--root', root, 'issue', 'execute', receipt.receiptId, '--connection', connection.id, '--authorize', receipt.authorize, '--json'];
  const results = await Effect.runPromise(Effect.all([1, 2].map(() => Effect.scoped(service.run(argv, { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, timeoutMs: 20_000 }))), { concurrency: 2 }));
  assert.deepEqual(results.map(result => result.exitCode).sort(), [0, 1]);
  assert.equal((JSON.parse(results.find(result => result.exitCode === 1)!.stderr) as { error: string }).error, 'IssuePlanConsumed');
  assert.equal(writes().length, 1);
  const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string };
  assert.equal(outcome.state, 'applied');
});
