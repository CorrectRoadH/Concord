import { initialize } from '../support/operations.js';
import { recoverLocalState } from '../../src/app/index.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { LocalRepository, runApplication } from "../support/repository.js";

import { renderTypeScriptConfig } from "../../src/base/workspace/index.js";
import { digest } from "../../src/model/index.js";
import { projectConfigPath, readProjectConfig } from '../support/support.js';
const fixture = () => { const root=mkdtempSync(join(tmpdir(),'concord-storage-'));execFileSync('git',['init','-q',root]);return root; };

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('project outlines preview without writes and recover using exact document paths', () => Effect.runPromise(Effect.sync(() => {
 const root = fixture(); let repo: LocalRepository | undefined;
 try {
  repo = new LocalRepository(root, { initialize: true, dryRun: true });
  const preview = initialize(repo, true);
  for (const path of ['docs/concepts.md', 'docs/architecture.md']) {
   assert.ok(preview.changedPaths.includes(path));
   assert.equal(existsSync(join(root, path)), false);
  }
  repo.close();
  repo = new LocalRepository(root, { initialize: true }); initialize(repo, false, { testRoots: [] });
  repo.publish('project-markdown', [{ path: 'docs/arbitrary.md', before: null, after: '# Project page\n' }]);
  assert.equal(repo.read('docs/arbitrary.md'), '# Project page\n');
  assert.throws(() => repo!.publish('out-of-scope', [{ path: 'arbitrary.md', before: null, after: '# No\n' }]), { code: 'InvalidChange' });
  const frozen = { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest };
  const changes = ['docs/concord.md', 'docs/architecture.md'].map(path => {
   const before = repo!.read(path)!; const after = '# Interrupted outline\n';
   return { path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 420 };
  });
  repo.close(); repo = undefined;
  for (const change of changes) writeFileSync(join(root, change.path), change.after);
  writeFileSync(join(root, '.git/concord/journal.json'), JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'outlines', phase: 'prepared', directories: [], scope: frozen, changes }));
  repo = new LocalRepository(root, { recover: true });
  assert.equal(repo.recover().status, 'rolled-back');
  for (const change of changes) assert.equal(repo.read(change.path), change.before);
 } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('dry-run creates no private state; init conflicts and symlinks preserve existing content',()=>Effect.runPromise(Effect.sync(()=>{
 const root=fixture();try {
  let repo=new LocalRepository(root,{initialize:true,dryRun:true});assert.equal(initialize(repo,true).dryRun,true);repo.close();assert.equal(existsSync(join(root,'concord.config.ts')),false);assert.equal(existsSync(join(root,'.git/concord')),false);
  repo=new LocalRepository(root,{initialize:true});assert.throws(()=>initialize(repo,false,{testRoots:['node_modules']}),{code:'InvalidSourcePath'});repo.close();assert.equal(existsSync(join(root,'concord.config.ts')),false);
  mkdirSync(join(root,'memory'));writeFileSync(join(root,'memory/README.md'),'existing');repo=new LocalRepository(root,{initialize:true});assert.throws(()=>initialize(repo),{code:'InitializationConflict'});repo.close();assert.equal(existsSync(join(root,'concord.config.ts')),false);assert.equal(readFileSync(join(root,'memory/README.md'),'utf8'),'existing');
  rmSync(join(root,'memory/README.md'));repo=new LocalRepository(root,{initialize:true});initialize(repo, false, { testRoots: [] });const parallel=new LocalRepository(root);parallel.close();repo.snapshot(()=>assert.throws(()=>new LocalRepository(root),{code:'RepositoryBusy'}));assert.throws(()=>repo.absolute('../escape'),{code:'UnsafePath'});symlinkSync('/tmp',join(root,'linked'));assert.throws(()=>repo.absolute('linked/x'),{code:'UnsafePath'});repo.close();
 } finally {rmSync(root,{recursive:true,force:true});}
})));
// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('interrupted multi-file publication rolls back, and recovery preserves external edits',()=>Effect.runPromise(Effect.sync(()=>{
 const root=fixture();let repo: LocalRepository | undefined;try {
  repo=new LocalRepository(root,{initialize:true});initialize(repo, false, { testRoots: [] });repo.close();
  mkdirSync(join(root,'docs/design/blocked'));writeFileSync(join(root,'memory/a.md'),'before');writeFileSync(join(root,'docs/design/blocked/b.md'),'before-b');
  const publishingRepo=new LocalRepository(root);repo=publishingRepo;chmodSync(join(root,'docs/design/blocked'),0o555);
  assert.throws(()=>publishingRepo.publish('failure',[{path:'memory/a.md',before:'before',after:'after'},{path:'docs/design/blocked/b.md',before:'before-b',after:'after-b'}]),{code:'RecoveryRequired'});publishingRepo.close();chmodSync(join(root,'docs/design/blocked'),0o755);
  assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'after');assert.throws(()=>new LocalRepository(root),{code:'RecoveryRequired'});
  writeFileSync(join(root,'memory/a.md'),'external');assert.throws(()=>new LocalRepository(root,{recover:true}),{code:'RecoveryConflict'});assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'external');
  writeFileSync(join(root,'memory/a.md'),'after');const recoveryRepo=new LocalRepository(root,{recover:true});repo=recoveryRepo;assert.equal(recoveryRepo.recover().status,'rolled-back');assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'before');assert.equal(readFileSync(join(root,'docs/design/blocked/b.md'),'utf8'),'before-b');recoveryRepo.close();
 } finally {repo?.close();chmodSync(join(root,'docs/design/blocked'),0o755);rmSync(root,{recursive:true,force:true});}
})));

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('unified journal recovers interrupted init, preflights every target, and preserves unknown formats',async () => {
 const root=fixture();let repo: LocalRepository | undefined;try {
  const config=renderTypeScriptConfig({testRoots:[],runner:{kind:'node-test',sourceFiles:[],timeoutMs:60000}});
  const guide='# guide\n'; const journalPath=join(root,'.git','concord','journal.json');mkdirSync(join(root,'.git','concord'),{recursive:true});mkdirSync(join(root,'docs'),{recursive:true});writeFileSync(join(root,'docs/concord.md'),guide);
  writeFileSync(journalPath,JSON.stringify({format:'concord.journal',root,privateDir:join(root,'.git','concord'),operation:'init',phase:'prepared',directories:['docs'],scope:{kind:'documents',configPath:'concord.config.ts',configSource:'',configDigest:digest('')},changes:[
   {path:'concord.config.ts',before:null,after:config,beforeDigest:null,afterDigest:digest(config),mode:420},
   {path:'docs/concord.md',before:null,after:guide,beforeDigest:null,afterDigest:digest(guide),mode:420},
  ]})+'\n');
  const recovered = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({status: Schema.Literal('rolled-back'), journalStatus: Schema.Literal('rolled-back')})))(JSON.stringify(await runApplication(recoverLocalState(root))));
  assert.equal(recovered.status,'rolled-back');assert.equal(existsSync(join(root,'concord.config.ts')),false);assert.equal(existsSync(join(root,'docs/concord.md')),false);
  const initial=new LocalRepository(root,{initialize:true});initialize(initial, false, { testRoots: ['test', 'tests'] });initial.close();
  writeFileSync(join(root,'memory/a.md'),'before-a');writeFileSync(join(root,'memory/b.md'),'before-b');const marker=readFileSync(join(root,projectConfigPath(root)),'utf8');
  const batch={format:'concord.journal',root,privateDir:join(root,'.git','concord'),operation:'batch',phase:'prepared',directories:[],scope:{kind:'documents',configPath:'concord.config.ts',configSource:marker,configDigest:digest(marker)},changes:[
   {path:'memory/a.md',before:'before-a',after:'after-a',beforeDigest:digest('before-a'),afterDigest:digest('after-a'),mode:420},
   {path:'memory/b.md',before:'before-b',after:'after-b',beforeDigest:digest('before-b'),afterDigest:digest('after-b'),mode:420},
  ]};
  writeFileSync(join(root,'memory/a.md'),'after-a');writeFileSync(join(root,'memory/b.md'),'external');writeFileSync(journalPath,JSON.stringify(batch)+'\n');assert.throws(()=>new LocalRepository(root,{recover:true}),{code:'RecoveryConflict'});assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'after-a');assert.equal(existsSync(journalPath),true);
  rmSync(journalPath);writeFileSync(journalPath,'{"format":"concord.journal/v2"}\n');assert.throws(()=>new LocalRepository(root,{recover:true}),{code:'InvalidData'});assert.equal(existsSync(journalPath),true);
 } finally {repo?.close();rmSync(root,{recursive:true,force:true});}
});
