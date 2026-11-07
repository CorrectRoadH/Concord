import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { decodeChangePreview } from '../../src/model/index.ts';
import { exportChangePreview } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';
const scratch = mkdtempSync(join(tmpdir(), 'concord-export-boundaries-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
function write(root: string, path: string, source: string) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); }
async function exportAt(root: string, out: string, base: string, head?: string) {
  return runApplication(exportChangePreview({ root, out, base, head })).then(
    value => ({ status: 0, stderr: '', value }),
    error => ({ status: 1, stderr: String(error.code), value: undefined }),
  );
}
// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('PR export preserves Git object types and refuses unsafe or incomplete exports', async () => {
 const root=join(scratch,'pr-export-boundaries');mkdirSync(root);
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 write(root,'docs/taste.md',readFileSync(new URL('../../templates/taste.md',import.meta.url),'utf8'));
 write(root,'empty.md','');write(root,'type.txt','ordinary content\n');write(root,'executable.sh','echo hello\n');write(root,'old.md','# Kept\n');
 git('add',".");git('commit','-qm','base');const base=git('rev-parse','HEAD');
 rmSync(join(root,'empty.md'));rmSync(join(root,'type.txt'));symlinkSync('/etc/passwd',join(root,'type.txt'));
 git('mv','old.md','空 白\n名.md');git('add',".");git('update-index','--chmod=+x','executable.sh');git('update-index','--add','--cacheinfo',`160000,${base},submodule`);
 git('commit','-qm','object types');const head=git('rev-parse','HEAD');git('replace',head,base);git('config','diff.ignoreSubmodules','all');
 const invoke = async (out: string, baseline = base, candidate = head) => exportAt(root, out, baseline, candidate);
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
 const shallowResult=await exportAt(shallow, join(scratch, 'shallow-out'), 'HEAD');assert.match(shallowResult.stderr,/PreviewShallowRepository/u);
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
