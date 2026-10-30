import { packageBin } from '../../scripts/package-location.js';
import { packConcord, installConcord } from './installed-package.js';
// @concord-file
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from './temporary.js';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { makeOwnedProcessService } from "../../src/base/process/index.js";
import { LocalRepository } from "./repository.js";
import { initialize } from "../../src/app/index.js";
import { setConfig, showConfig } from "../../src/app/index.js";

export interface Call { readonly args: readonly string[]; readonly stdin: string; readonly env: Readonly<Record<string, unknown>> }
export interface Receipt { readonly receiptId: string; readonly authorize: string; readonly payloadDigest: string; readonly expiresAt: string; readonly target: string }
export const connection = { id: 'product-gh', provider: 'github', transport: 'gh', owner: 'example', repo: 'product', repositoryId: '42' } as const;
export const issue = (number = 12, extra: Readonly<Record<string, unknown>> = {}) => ({ number, html_url: `https://github.com/example/product/issues/${number}`, title: 'Planned title', body: 'initial', state: 'open', labels: [{ name: 'old' }], ...extra });
export const scratch = mkdtempSync(join(tmpdir(), 'concord-issue-remote-'));
export const bin = join(scratch, 'bin');
export const scenarioFile = join(scratch, 'scenario.json');
export const callsFile = join(scratch, 'calls.ndjson');
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
export let packedCli: string;
test.before(() => Effect.runPromise(Effect.sync(() => {
  const packed = packConcord(scratch);
  const tool = join(scratch, 'tool'); mkdirSync(tool); writeFileSync(join(tool, 'package.json'), '{"private":true}');
  installConcord(tool, packed);
  packedCli = packageBin(join(tool, 'node_modules/concord-sdlc'));
})));
test.after(() => { rmSync(scratch, { recursive: true, force: true }); });
export function consumer(name: string, selected: unknown = connection): string {
  const root = join(scratch, name); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true }); try { initialize(initial); } finally { initial.close(); }
  const repository = new LocalRepository(root);
  try { const config = showConfig(repository); setConfig(repository, { ...config.config, feedbackConnections: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))([selected]) as typeof config.config.feedbackConnections }, config.digest); }
  finally { repository.close(); }
  return root;
}
export function mode(extra: Readonly<Record<string, unknown>> = {}) { writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [], ...extra })); writeFileSync(callsFile, ''); }
export function calls(): readonly Call[] { return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(source => JSON.parse(source) as Call); }
export function writes(): readonly Call[] { return calls().filter(call => call.args.includes('--method') && call.args[call.args.indexOf('--method') + 1] !== 'GET'); }
export function cli(root: string, args: readonly string[], timeout = 150_000) {
  return spawnSync(process.execPath, [packedCli, '--root', root, 'issue', ...args, '--json'], { cwd: root, encoding: 'utf8', timeout, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, GH_DEBUG: 'api', GH_REPO: 'attacker/other' } });
}
export function plan(root: string, operation: string, args: readonly string[] = ['12']): Receipt {
  const result = cli(root, ['plan', operation, ...args, '--connection', connection.id]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout) as Receipt;
  assert.equal(writes().length, 0);
  assert.match(receipt.authorize, new RegExp(`^${operation}:example/product(?:#12)?@[a-f0-9]{12}$`));
  assert.equal(receipt.authorize.split('@')[1], receipt.payloadDigest.slice(7, 19));
  assert.equal(statSync(join(root, '.git/concord/issue-plan/v1/planned', `${receipt.receiptId}.json`)).mode & 0o777, 0o600);
  return receipt;
}
export function execute(root: string, receipt: Receipt, authorization = receipt.authorize, selected: string = connection.id) { return cli(root, ['execute', receipt.receiptId, '--connection', selected, '--authorize', authorization]); }
export function error(result: ReturnType<typeof cli>, code: string | readonly string[]) { assert.equal(result.status, 1, result.stdout); const actual = (JSON.parse(result.stderr) as { error: string }).error; if (typeof code === 'string') assert.equal(actual, code, result.stderr); else assert.ok(code.includes(actual), result.stderr); }
export function alterReceipt(root: string, receipt: Receipt, patch: Readonly<Record<string, unknown>>) {
  const path = join(root, '.git/concord/issue-plan/v1/planned', `${receipt.receiptId}.json`);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')) as object, ...patch }));
}

export { packageBin };
export { packConcord };
export { installConcord };
export { assert };
export { execFileSync };
export { spawnSync };
export { existsSync };
export { mkdirSync };
export { mkdtempSync };
export { readFileSync };
export { rmSync };
export { writeFileSync };
export { statSync };
export { tmpdir };
export { join };
export { resolve };
export { test };
export { Effect };
export { Schema };
export { makeOwnedProcessService };
export { LocalRepository };
export { initialize };
export { setConfig };
export { showConfig };
