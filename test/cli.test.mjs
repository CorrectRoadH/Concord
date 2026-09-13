import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const scratch=mkdtempSync(join(tmpdir(),'concord-installed-'));
let cli;
before(()=>{
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',scratch],{cwd:resolve('.'),encoding:'utf8',timeout:60000}));
 const install=join(scratch,'tool');mkdirSync(install);writeFileSync(join(install,'package.json'),JSON.stringify({private:true}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',join(scratch,packed[0].filename)],{cwd:install,encoding:'utf8',timeout:60000});
 cli=join(install,'node_modules/concord-sdlc/dist/cli.js');
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
