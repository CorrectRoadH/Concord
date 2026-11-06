import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.js';

import { decodeChangePreview } from '../../src/model/change-preview.js';

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
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
 call(root,['new', 'issue','pending','--title','Pending observation'],Ack);
 const feedbackList=Schema.Struct({feedback:Schema.Array(Schema.Struct({document:Schema.Struct({metadata:Schema.Struct({id:Schema.String})})}))});
 const issueList=Schema.Struct({drafts:Schema.Array(Schema.Struct({metadata:Schema.Struct({id:Schema.String})}))});
 assert.deepEqual(call(root,['feedback','list','--provider','local','--triage','linked','--query','LOCAL'],feedbackList).feedback.map(item=>item.document.metadata.id),['observation']);
 assert.deepEqual(call(root,['feedback','list','--triage','pending'],feedbackList).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.deepEqual(call(root,['feedback','list','--provider','github'],feedbackList).feedback,[]);
 assert.deepEqual(call(root,['action','--input','-'],feedbackList,JSON.stringify({action:'feedback.list',provider:'local',triage:'pending'})).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.deepEqual(call(root,['action','--input','-'],issueList,JSON.stringify({action:'issue.list',query:'Local observation'})).drafts.map(item=>item.metadata.id),['observation']);
 call(root,['action','--input','-'],ErrorOutput,JSON.stringify({action:'feedback.list',state:'draft'}),1);
 call(root,['feedback','connection','remove','github-main'],Ack);
 assert.ok(existsSync(join(root,relative)),'removing a connection must preserve local observations');
 call(root,['issue','close','observation','--reason','Investigation complete'],Ack);
 assert.equal(existsSync(join(root,relative)),false);
 assert.deepEqual(call(root,['feedback','list','--provider','local'],feedbackList).feedback.map(item=>item.document.metadata.id),['pending']);
 assert.equal(call(root,['check'],CheckOutput).ok,true);
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
 const invoke=(out:string,baseline=base,candidate=head)=>spawnSync(process.execPath,[cli,'--root',root,'--json','view','export','--base',baseline,'--head',candidate,'--out',out],{encoding:'utf8',timeout:120000});
 const out=join(scratch,'types-preview');const success=invoke(out);assert.equal(success.status,0,success.stderr);
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
  execFileSync(process.execPath,['--import','tsx','-e',''],{env:{...process.env,TMPDIR:temporary}});
  const loaderEntries=readdirSync(temporary).sort();
  const child=spawn(process.execPath,[cli,'--root',root,'--json','view','export','--base',base,'--head',head,'--out',join(scratch,'cancelled-out')],{env:{...process.env,PATH:shim+':'+process.env.PATH,TMPDIR:temporary,CONCORD_TEST_GIT_PID:pidFile},stdio:'ignore'});
  const exited=once(child,'exit');
  try{
   const deadline=Date.now()+15000;while(!existsSync(pidFile)&&Date.now()<deadline)await Effect.runPromise(Effect.sleep('20 millis'));
   assert.ok(existsSync(pidFile),'export reached the scoped Git comparison');const pid=Number(readFileSync(pidFile,'utf8').trim());
   child.kill('SIGTERM');await exited;assert.throws(()=>process.kill(pid,0));assert.deepEqual(readdirSync(temporary).sort(),loaderEntries,'interruption releases the temporary Git repository');
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 }
});
