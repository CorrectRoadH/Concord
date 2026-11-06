import { assert, execFileSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, join, test, after, pathToFileURL, Effect, Schema, readProjectConfig, parseDocumentRecord, Ack, ErrorOutput, CheckOutput, scratch, runCli, call, consumer, write } from '../support/cli-fixture.ts';

import { decodeChangePreview } from '../../src/model/change-preview.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('packed feedback commands persist connections and local triage without remote calls', () => Effect.runPromise(Effect.promise(async () => {
 const root=consumer('packed-feedback');
 (await call(root,['feedback','connection','add','--id','github-main','--provider','github','--owner','example','--repo','demo','--credential-env','CONCORD_TEST_MISSING_TOKEN'],Ack));
 (await call(root,['feedback','connection','add','--id','linear-main','--provider','linear','--team','TEAM','--credential-env','CONCORD_TEST_MISSING_LINEAR_KEY'],Ack));
 const project=readProjectConfig(root);
 assert.deepEqual(project.feedbackConnections?.map(connection=>connection.provider),['github','linear']);
 (await call(root,['new', 'feature','feedback-target','--title','Feedback target'],Ack));
 (await call(root,['new', 'issue','observation','--title','Local observation'],Ack));
 (await call(root,['issue','link','observation','--role','spec','docs/feature/feedback-target/README.md'],Ack));
 const relative='docs/issues/observation.md';
 const linked=parseDocumentRecord(relative,readFileSync(join(root,relative),'utf8'), parserRuntime);
 assert.equal(linked?.metadata.kind,'issue');
 if(linked?.metadata.kind!=='issue')assert.fail('feedback must retain the local issue owner');
 assert.deepEqual(linked.metadata.relations.filter(relation => relation.role === 'spec').map(relation => relation.target),['docs/feature/feedback-target/README.md']);
 assert.equal(linked.metadata.source,undefined);
 const listed=(await call(root,['feedback','list'],Schema.Unknown));
 assert.match(JSON.stringify(listed),/observation/);
 (await call(root,['feedback','show','observation'],Schema.Unknown));
 (await call(root,['new', 'issue','pending','--title','Pending observation'],Ack));
 const feedbackList=Schema.Struct({feedback:Schema.Array(Schema.Struct({document:Schema.Struct({metadata:Schema.Struct({id:Schema.String})})}))});
 const issueList=Schema.Struct({drafts:Schema.Array(Schema.Struct({metadata:Schema.Struct({id:Schema.String})}))});
 assert.deepEqual((await call(root,['feedback','list','--provider','local','--triage','linked','--query','LOCAL'],feedbackList)).feedback.map(item=>item.document.metadata.id),['observation']);
 assert.deepEqual((await call(root,['feedback','list','--triage','pending'],feedbackList)).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.deepEqual((await call(root,['feedback','list','--provider','github'],feedbackList)).feedback,[]);
 assert.deepEqual((await call(root,['action','--input','-'],feedbackList,JSON.stringify({action:'feedback.list',provider:'local',triage:'pending'}))).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.deepEqual((await call(root,['action','--input','-'],issueList,JSON.stringify({action:'issue.list',query:'Local observation'}))).drafts.map(item=>item.metadata.id),['observation']);
 (await call(root,['action','--input','-'],ErrorOutput,JSON.stringify({action:'feedback.list',state:'draft'}),1));
 (await call(root,['feedback','connection','remove','github-main'],Ack));
 assert.ok(existsSync(join(root,relative)),'removing a connection must preserve local observations');
 (await call(root,['issue','close','observation','--reason','Investigation complete'],Ack));
 assert.equal(existsSync(join(root,relative)),false);
 assert.deepEqual((await call(root,['feedback','list','--provider','local'],feedbackList)).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.equal((await call(root,['check'],CheckOutput)).ok,true);
})));


// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('packed PR export preserves Git object types and refuses unsafe or incomplete exports', async () => {
 const root=join(scratch,'pr-export-boundaries');mkdirSync(root);
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 write(root,'docs/taste.md',readFileSync(new URL('../../templates/taste.md',import.meta.url),'utf8'));
 write(root,'empty.md','');write(root,'type.txt','ordinary content\n');write(root,'executable.sh','echo hello\n');write(root,'old.md','# Kept\n');
 git('add',".");git('commit','-qm','base');const base=git('rev-parse','HEAD');
 rmSync(join(root,'empty.md'));rmSync(join(root,'type.txt'));symlinkSync('/etc/passwd',join(root,'type.txt'));
 git('mv','old.md','空 白\n名.md');git('add',".");git('update-index','--chmod=+x','executable.sh');git('update-index','--add','--cacheinfo',`160000,${base},submodule`);
 git('commit','-qm','object types');const head=git('rev-parse','HEAD');git('replace',head,base);git('config','diff.ignoreSubmodules','all');
 const invoke=async(out:string,baseline=base,candidate=head)=>{const result=await runCli({argv:['--root',root,'--json','view','export','--base',baseline,'--head',candidate,'--out',out],cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(120000)});return {...result,status:result.exitCode};};
 const out=join(scratch,'types-preview');const success=await invoke(out);assert.equal(success.status,0,success.stderr);
 const data=decodeChangePreview(JSON.parse(readFileSync(join(out,'changes.json'),'utf8')));
 assert.equal(data.entries.find(entry=>entry.path==='submodule')?.after?.mode,'160000');
 assert.equal(data.entries.find(entry=>entry.path==='type.txt')?.status,'T');assert.equal(data.entries.find(entry=>entry.path==='type.txt')?.after?.mode,'120000');
 assert.equal(data.entries.find(entry=>entry.path==='executable.sh')?.after?.mode,'100755');
 const removed=data.entries.find(entry=>entry.path==='empty.md');assert.equal(removed?.beforeMarkdown,'');assert.equal(removed?.after,null);
 assert.equal(data.entries.find(entry=>entry.path==='空 白\n名.md')?.previousPath,'old.md');assert.doesNotMatch(JSON.stringify(data),/root:x:/u);
 const sentinel=join(out,'keep');writeFileSync(sentinel,'unknown');assert.match((await invoke(out)).stderr,/PreviewOutputExists/u);assert.equal(readFileSync(sentinel,'utf8'),'unknown');
 assert.match((await invoke(root)).stderr,/PreviewUnsafeOutput/u);assert.match((await invoke(join(root,'.git','export'))).stderr,/PreviewUnsafeOutput/u);
 const alias=join(scratch,'preview-output-alias');symlinkSync(scratch,alias,'dir');assert.match((await invoke(join(alias,'no-output'))).stderr,/PreviewUnsafeOutput/u);
 const missing=join(scratch,'missing-history-preview');assert.equal((await invoke(missing,'no-such-branch')).status,1);assert.equal(existsSync(missing),false);
 const shallow=join(scratch,'shallow-pr');execFileSync('git',['clone','--quiet','--depth','1',pathToFileURL(root).href,shallow]);
 const shallowResult=await runCli({argv:['--root',shallow,'--json','view','export','--base','HEAD','--out',join(scratch,'shallow-out')],cwd:process.cwd(),env:process.env});assert.match(shallowResult.stderr,/PreviewShallowRepository/u);
 git('replace','-d',head);
 writeFileSync(join(root,'oversized.txt'),Buffer.alloc(4*1024*1024+1,97));git('add','oversized.txt');git('commit','-qm','large object');
 const large=join(scratch,'large-out');assert.match((await invoke(large,head,'HEAD')).stderr,/PreviewBudgetExceeded/u);assert.equal(existsSync(large),false);
 rmSync(join(root,'oversized.txt'));git('add','-A');git('commit','-qm','remove large object');const clean=git('rev-parse','HEAD');
 // Darwin rejects invalid UTF-8 filenames before Git can record them.
 if(process.platform==='linux'){
  const invalid=Buffer.concat([Buffer.from(root+'/'),Buffer.from([255])]);writeFileSync(invalid,'bytes');git('add','-A');git('commit','-qm','non UTF-8 path');
  assert.match((await invoke(join(scratch,'invalid-path-out'),clean,'HEAD')).stderr,/GitPathEncodingUnsupported/u);
 }

});
