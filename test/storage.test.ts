import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, initialize } from '../dist/storage.js';
const fixture = () => { const root=mkdtempSync(join(tmpdir(),'concord-storage-'));execFileSync('git',['init','-q',root]);return root; };
// @concord-case storage-rejects-conflicts-and-unsafe-paths
// @concord-contract docs/feature/local-sdlc/use-case/recover-local-state.md
test('dry-run creates no private state; init conflicts and symlinks preserve existing content',()=>Effect.runPromise(Effect.sync(()=>{
 const root=fixture();try {
  let repo=new LocalRepository(root,{initialize:true,dryRun:true});assert.equal(initialize(repo,true).dryRun,true);repo.close();assert.equal(existsSync(join(root,'concord.json')),false);assert.equal(existsSync(join(root,'.git/concord')),false);
  mkdirSync(join(root,'memory'));writeFileSync(join(root,'memory/README.md'),'existing');repo=new LocalRepository(root,{initialize:true});assert.throws(()=>initialize(repo),{code:'InitializationConflict'});repo.close();assert.equal(existsSync(join(root,'concord.json')),false);assert.equal(readFileSync(join(root,'memory/README.md'),'utf8'),'existing');
  rmSync(join(root,'memory/README.md'));repo=new LocalRepository(root,{initialize:true});initialize(repo);assert.throws(()=>new LocalRepository(root),{code:'RepositoryBusy'});assert.throws(()=>repo.absolute('../escape'),{code:'UnsafePath'});symlinkSync('/tmp',join(root,'linked'));assert.throws(()=>repo.absolute('linked/x'),{code:'UnsafePath'});repo.close();
 } finally {rmSync(root,{recursive:true,force:true});}
})));
// @concord-case storage-recovers-atomic-publication
// @concord-contract docs/feature/local-sdlc/use-case/recover-local-state.md
test('interrupted multi-file publication rolls back, and recovery preserves external edits',()=>Effect.runPromise(Effect.sync(()=>{
 const root=fixture();let repo: LocalRepository | undefined;try {
  repo=new LocalRepository(root,{initialize:true});initialize(repo);repo.close();
  mkdirSync(join(root,'docs/design/blocked'));writeFileSync(join(root,'memory/a.md'),'before');writeFileSync(join(root,'docs/design/blocked/b.md'),'before-b');
  const publishingRepo=new LocalRepository(root);repo=publishingRepo;chmodSync(join(root,'docs/design/blocked'),0o555);
  assert.throws(()=>publishingRepo.publish('failure',[{path:'memory/a.md',before:'before',after:'after'},{path:'docs/design/blocked/b.md',before:'before-b',after:'after-b'}]),{code:'RecoveryRequired'});publishingRepo.close();chmodSync(join(root,'docs/design/blocked'),0o755);
  assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'after');assert.throws(()=>new LocalRepository(root),{code:'RecoveryRequired'});
  writeFileSync(join(root,'memory/a.md'),'external');const conflictingRepo=new LocalRepository(root,{recover:true});repo=conflictingRepo;assert.throws(()=>conflictingRepo.recover(),{code:'RecoveryConflict'});assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'external');conflictingRepo.close();
  writeFileSync(join(root,'memory/a.md'),'after');const recoveryRepo=new LocalRepository(root,{recover:true});repo=recoveryRepo;assert.equal(recoveryRepo.recover().status,'rolled-back');assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'before');assert.equal(readFileSync(join(root,'docs/design/blocked/b.md'),'utf8'),'before-b');recoveryRepo.close();
 } finally {repo?.close();chmodSync(join(root,'docs/design/blocked'),0o755);rmSync(root,{recursive:true,force:true});}
})));
