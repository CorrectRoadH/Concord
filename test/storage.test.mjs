import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRepository, initialize } from '../dist/storage.js';
const fixture = () => { const root=mkdtempSync(join(tmpdir(),'concord-storage-'));execFileSync('git',['init','-q',root]);return root; };
test('dry-run creates no private state; init conflicts and symlinks preserve existing content',()=>{
 const root=fixture();try {
  let repo=new LocalRepository(root,{initialize:true,dryRun:true});assert.equal(initialize(repo,true).dryRun,true);repo.close();assert.equal(existsSync(join(root,'concord.json')),false);assert.equal(existsSync(join(root,'.git/concord')),false);
  mkdirSync(join(root,'memory'));writeFileSync(join(root,'memory/README.md'),'existing');repo=new LocalRepository(root,{initialize:true});assert.throws(()=>initialize(repo),{code:'InitializationConflict'});repo.close();assert.equal(existsSync(join(root,'concord.json')),false);assert.equal(readFileSync(join(root,'memory/README.md'),'utf8'),'existing');
  rmSync(join(root,'memory/README.md'));repo=new LocalRepository(root,{initialize:true});initialize(repo);assert.throws(()=>new LocalRepository(root),{code:'RepositoryBusy'});assert.throws(()=>repo.absolute('../escape'),{code:'UnsafePath'});symlinkSync('/tmp',join(root,'linked'));assert.throws(()=>repo.absolute('linked/x'),{code:'UnsafePath'});repo.close();
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('interrupted multi-file publication rolls back, and recovery preserves external edits',()=>{
 const root=fixture();let repo;try {
  repo=new LocalRepository(root,{initialize:true});initialize(repo);repo.close();
  mkdirSync(join(root,'docs/design/blocked'));writeFileSync(join(root,'memory/a.md'),'before');writeFileSync(join(root,'docs/design/blocked/b.md'),'before-b');
  repo=new LocalRepository(root);chmodSync(join(root,'docs/design/blocked'),0o555);
  assert.throws(()=>repo.publish('failure',[{path:'memory/a.md',before:'before',after:'after'},{path:'docs/design/blocked/b.md',before:'before-b',after:'after-b'}]),{code:'RecoveryRequired'});repo.close();chmodSync(join(root,'docs/design/blocked'),0o755);
  assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'after');assert.throws(()=>new LocalRepository(root),{code:'RecoveryRequired'});
  writeFileSync(join(root,'memory/a.md'),'external');repo=new LocalRepository(root,{recover:true});assert.throws(()=>repo.recover(),{code:'RecoveryConflict'});assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'external');repo.close();
  writeFileSync(join(root,'memory/a.md'),'after');repo=new LocalRepository(root,{recover:true});assert.equal(repo.recover().status,'rolled-back');assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'before');assert.equal(readFileSync(join(root,'docs/design/blocked/b.md'),'utf8'),'before-b');repo.close();
 } finally {repo?.close();chmodSync(join(root,'docs/design/blocked'),0o755);rmSync(root,{recursive:true,force:true});}
});
