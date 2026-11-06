import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { expect } from '@playwright/test';
import { test } from './fixtures.ts';

import { sourceCli } from '../support/source-consumer.ts';



import { decodeChangePreview } from '../../src/model/index.ts';
const cli=sourceCli();
const write=(root:string,path:string,source:string)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),source);};

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('packed PR export compares the actual target and serves a safe static review under a subpath', async ({ page, workspace }) => {
 const scratch=workspace.privateRoot();
 const root = join(scratch, 'pr-export'); mkdirSync(root);
 const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
 git('init', '-q', '-b', 'release'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
 write(root,'docs/taste.md',readFileSync(new URL('../../templates/taste.md',import.meta.url),'utf8'));
 write(root,'docs/old.md','# Before\n\nShared text.\n');
 write(root,'source.ts','export const value = 1;\n');
 git('add',"."); git('commit','-qm','ancestor'); const ancestor = git('rev-parse','HEAD');
 git('checkout','-qb','topic');
 git('mv','docs/old.md','docs/renamed.md');
 write(root,'source.ts','export const value = 2;\n');
 write(root,'docs/new.md','# After\n\n<script>window.previewExecuted = true</script>\n\n![remote](https://example.invalid/tracker.png)\n\n```p5\nwindow.previewExecuted = true\n```\n');
 writeFileSync(join(root,'binary.dat'),Buffer.from([0,1,2,3]));
 git('add',"."); git('commit','-qm','PR changes'); const head = git('rev-parse','HEAD');
 git('checkout','-q','release'); write(root,'target-only.txt','Do not show in PR\n'); git('add',".");git('commit','-qm','target advance');const base = git('rev-parse','HEAD');
 git('checkout','-q','topic'); write(root,'source.ts','PRIVATE DIRTY CONTENT\n');
 write(root,'.gitattributes','* -diff\n'); write(root,'concord.config.ts','throw new Error("must not execute configuration");\n');
 git('config','diff.external','must-not-run'); git('config','diff.ignoreSubmodules','all');
 const out = join(scratch,'exported-pr');
 const result = spawnSync(process.execPath,['--no-addons',cli,'--root',join(root,'docs'),'--json','view','export','--base',base,'--head',head,'--base-label','release','--out',out],{encoding:'utf8',timeout:120000});
 assert.equal(result.status,0,result.stderr + result.stdout);
 const data = decodeChangePreview(JSON.parse(readFileSync(join(out,'changes.json'),'utf8')));
 assert.deepEqual(data.comparison,{base,head,mergeBase:ancestor,baseLabel:'release'});
 assert.deepEqual(data.entries.map(entry=>entry.path).sort(),['binary.dat','docs/new.md','docs/renamed.md','source.ts']);
 assert.equal(data.entries.find(entry=>entry.path==='docs/renamed.md')?.previousPath,'docs/old.md');
 assert.equal(data.entries.find(entry=>entry.path==='binary.dat')?.binary,true);
 assert.match(data.entries.find(entry=>entry.path==='source.ts')!.patch,/\+export const value = 2/u);
 assert.doesNotMatch(JSON.stringify(data),/PRIVATE DIRTY|target-only/u);
 assert.throws(()=>decodeChangePreview({...data,unrecognized:true}));
 assert.throws(()=>decodeChangePreview({...data,entries:[...data.entries,data.entries[0]]}));
 const again = spawnSync(process.execPath,[cli,'--root',root,'--json','view','export','--base',base,'--head',head,'--out',out],{encoding:'utf8'});
 assert.equal(again.status,1); assert.match(again.stderr,/PreviewOutputExists/u);
 const server = createServer((request,response)=>{
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if(!pathname.startsWith('/pr/concord/')){response.writeHead(404).end();return;}
  const relative = decodeURIComponent(pathname.slice('/pr/concord/'.length)) || 'index.html';
  if(relative.split('/').includes("..")){response.writeHead(400).end();return;}
  try {const bytes = readFileSync(join(out,relative));response.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':'text/html');response.end(bytes);}
  catch {response.writeHead(404).end();}
 });
 try {
  server.listen(0,'127.0.0.1');await once(server,'listening');const address = server.address();assert.ok(address && typeof address==='object');
  const unexpected:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1'||new URL(request.url()).pathname.startsWith('/api/'))unexpected.push(request.url());});
  await page.goto(`http://127.0.0.1:${address.port}/pr/concord/`);
  await expect(page.getByText('release',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'source.ts',exact:true}).click();await expect(page.locator('[data-git-diff]')).toContainText('value = 2');
  await page.getByRole('button',{name:'docs/new.md',exact:true}).click();
  await page.getByRole('button',{name:'变更后',exact:true}).click();await expect(page.getByRole('heading',{name:'After',exact:true})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);assert.equal(await page.evaluate(()=>Reflect.get(window,'previewExecuted')),undefined);
  await page.reload();await expect(page.getByRole('heading',{name:'After',exact:true})).toBeVisible();assert.deepEqual(unexpected,[]);
 } finally {await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));}
});
