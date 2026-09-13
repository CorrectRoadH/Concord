import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const scratch=mkdtempSync(join(tmpdir(),'concord-installed-'));
let cli;
before(()=>{
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',scratch],{cwd:resolve('.'),encoding:'utf8',timeout:60000}));
 assert.ok(packed[0].files.some(file=>file.path==='npm-shrinkwrap.json'), 'package must carry its runtime dependency lock');
 const install=join(scratch,'tool');mkdirSync(install);writeFileSync(join(install,'package.json'),JSON.stringify({private:true}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',join(scratch,packed[0].filename)],{cwd:install,encoding:'utf8',timeout:60000});
 cli=join(install,'node_modules/concord-sdlc/dist/entry.js');
});
after(()=>rmSync(scratch,{recursive:true,force:true}));
function call(root,args,input='Contract body.\n',status=0){
 const result=spawnSync(process.execPath,[cli,'--root',root,'--json',...args],{input,encoding:'utf8',timeout:20000});
 assert.equal(result.status,status,JSON.stringify({args,stdout:result.stdout,stderr:result.stderr,error:result.error}));
 return JSON.parse(status===0||result.stdout.trim()?result.stdout:result.stderr);
}
function consumer(name){const root=join(scratch,name);mkdirSync(root);execFileSync('git',['init','-q',root]);call(root,['init']);return root;}
function write(root,path,source){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),source);}
test('installed CLI connects contracts, real red/green execution, Memory history and cache',()=>{
 const root=consumer('flow');
 call(root,['feature','create','arithmetic','--title','Arithmetic','--body','-']);
 call(root,['use-case','create','addition','--feature','arithmetic','--title','Addition','--body','-']);
 call(root,['memory','add','sum-bug','--kind','problem','--title','Incorrect sum','--body','-']);
 write(root,'src/math.mjs','export const sum=(a,b)=>a-b;\n');
 write(root,'test/math.test.mjs',`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {sum} from '../src/math.mjs';\n// @concord-case sum-adds\n// @concord-contract docs/feature/arithmetic/use-case/addition.md\n// @concord-regression memory/sum-bug.md\ntest('adds numbers',()=>assert.equal(sum(2,3),5));\n`);
 assert.equal(call(root,['check']).ok,true);
 const red=call(root,['test','run','sum-adds'],'',1);assert.equal(red.commandOutcome,'fail');assert.equal(red.execution,'nonzero');
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b;\n');
 const green=call(root,['test','run','sum-adds']);assert.equal(green.commandOutcome,'pass');assert.equal(green.execution,'nonzero');
 const resolveArgs=['memory','resolve','sum-bug','--kind','fixed','--red',red.id,'--green',green.id,'--reason','Correct addition verified'];
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b+1;\n');
 assert.equal(call(root,resolveArgs,'',1).error,'EvidenceStale');
 write(root,'src/math.mjs','export const sum=(a,b)=>a+b;\n');
 const originalTest=readFileSync(join(root,'test/math.test.mjs'),'utf8');
 write(root,'test/math.test.mjs',originalTest+'// changed test definition\n');
 assert.equal(call(root,resolveArgs,'',1).error,'EvidenceStale');
 write(root,'test/math.test.mjs',originalTest);
 call(root,resolveArgs);
 const memory=call(root,['memory','show','sum-bug']).document;assert.equal(memory.metadata.state,'resolved');assert.equal(memory.metadata.resolution.evidenceLevel,'command');
 assert.equal(call(root,['trace','check']).ok,true);assert.match(call(root,['review','render']),/sum-bug/);
 call(root,['cache','clear']);assert.equal(call(root,['test','evidence',green.id]).id,green.id);
 call(root,['memory','reopen','sum-bug','--reason','New observation']);
 assert.equal(call(root,['memory','show','sum-bug']).document.metadata.epoch,1);
 assert.equal(call(root,['memory','resolve','sum-bug','--kind','fixed','--red',red.id,'--green',green.id,'--reason','Old proof'],'',1).error,'EvidenceStale');
 const nested=spawnSync(process.execPath,[cli,'--json','feature','list'],{cwd:join(root,'src'),encoding:'utf8',timeout:10000});assert.equal(nested.status,0,nested.stderr);
});
test('installed CLI adoption moves current promotions atomically; local issue lifecycle stays explicit',()=>{
 const root=consumer('lifecycle');
 call(root,['roadmap','create','sharing','--title','Sharing','--body','-']);
 call(root,['memory','add','sharing-rule','--kind','decision','--title','Sharing decision','--body','-']);
 call(root,['memory','promote','sharing-rule','--target','docs/roadmap/sharing/README.md']);
 call(root,['roadmap','adopt','sharing','--feature','sharing']);
 assert.deepEqual(call(root,['memory','show','sharing-rule']).document.metadata.promotions,['docs/feature/sharing/README.md']);
 call(root,['issue','draft','observation','--title','Observation','--body','-']);
 call(root,['issue','link','observation','--memory','memory/sharing-rule.md']);
 call(root,['issue','close','observation','--reason','Decision adopted']);
 assert.equal(call(root,['check']).ok,true);
 const source=readFileSync(join(root,'memory/sharing-rule.md'),'utf8');
 call(root,['--dry-run','memory','retire','sharing-rule','--target','docs/feature/sharing/README.md','--reason','Preview']);
 assert.equal(readFileSync(join(root,'memory/sharing-rule.md'),'utf8'),source);
});
test('installed CLI returns a named failure for a known skipped declaration',()=>{
 const root=consumer('skipped');
 call(root,['feature','create','skip-feature','--title','Skip feature','--body','-']);
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @concord-case skipped-case\n// @concord-contract docs/feature/skip-feature/README.md\ntest.skip('skipped',()=>{});\n");
 assert.equal(call(root,['test','run','skipped-case'],'',1).error,'CaseNotRunnable');
});
test('installed repository profile keeps lifecycle behavior and refuses mismatched hosts or engines',()=>{
 const root=join(scratch,'repository-profile');mkdirSync(root);execFileSync('git',['init','-q',root]);
 write(root,'package.json',JSON.stringify({private:true,type:'module'}));
 write(root,'concord.repository.json',JSON.stringify({format:'concord.repository/v1',host:'host.mjs'}));
 const dependencyRoot=join(scratch,'tool/node_modules');
 symlinkSync(dependencyRoot,join(root,'node_modules'),'dir');
 const hostSource=`import {Layer} from 'effect';\nconst forbidden=()=>{throw new Error('Native collection was not requested');};\nexport default {format:'concord.repository-host/v1',repositoryRoot:process.cwd(),QUERY_PROTOCOL:'niceeval.query/v1',OwnedProcessLive:Layer.empty,collectRepoCaseInventory:forbidden,collectWorkspaceCaseInventory:forbidden,managedInventoryImplementationDigest:forbidden,readManagedInventoryReceipt:forbidden,readManagedRedEvidence:forbidden,readManagedTakeoverEvidence:forbidden};\n`;
 write(root,'host.mjs',hostSource);
 for(const directory of ['docs','e2e','feedback','memory'])mkdirSync(join(root,directory));
 execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','Initialize fixture']);
 const profile=(args,input='A durable engineering observation.\n')=>spawnSync(process.execPath,[cli,'repo',...args],{cwd:root,input,encoding:'utf8',timeout:15000});
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
});
