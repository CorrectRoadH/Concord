import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.ts';
import { decodeChangePreview } from '../../src/model/change-preview.ts';

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name packed-operation-boundaries
test('packed local operations isolate unrelated malformed contracts and check reports all failures', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('operation-boundaries');
 call(root, ['new', 'feature', 'target', '--title', 'Target'], Ack);
 call(root, ['new', 'feature', 'broken-a', '--title', 'Broken A'], Ack);
 call(root, ['new', 'feature', 'broken-b', '--title', 'Broken B'], Ack);
 for (const id of ['broken-a', 'broken-b']) write(root, `docs/feature/${id}/README.md`, '---\nformat: concord.document/v1\nkind: feature\n---\n# Incomplete owner\n');
 const target = 'docs/feature/target/README.md';
 assert.match(call(root, ['code', 'marker', '--scope', 'file', '--contract', target], AnnotationOutput).snippet, /@concord-implements docs\/feature\/target\/README.md/u);
 assert.match(call(root, ['test', 'marker', '--contract', target], AnnotationOutput).snippet, /@feature docs\/feature\/target\/README.md/u);
 call(root, ['new', 'memory', 'repair-note', '--title', 'Repair note'], Ack);
 const index = call(root, ['list', 'memory'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })) }));
 const note = index.documents.find(record => record.path === 'memory/repair-note.md');
 assert.ok(note);
 call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path: note.path, body: '# Repair note\n\nObserved broken contract metadata.\n', expectedDigest: note.digest }));
 const recalled = call(root, ['memory', 'search', 'broken contract'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ body: Schema.String })) }));
 assert.equal(recalled.documents.length, 1);
 assert.match(recalled.documents[0]!.body, /Observed broken contract metadata/u);
 const listed = call(root, ['list', 'memory'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) }));
 assert.equal(listed.documents[0]?.id, 'repair-note');
 call(root, ['new', 'issue', 'repair-observation', '--title', 'Repair observation'], Ack);
 assert.equal(call(root, ['list', 'issue'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) })).documents[0]?.id, 'repair-observation');
 const checked = call(root, ['check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String })) }), '', 1);
 assert.equal(checked.ok, false);
 for (const id of ['broken-a', 'broken-b']) assert.ok(checked.findings.some(finding => finding.path === `docs/feature/${id}/README.md`));
 assert.equal(call(root, ['code', 'marker', '--scope', 'file', '--contract', 'docs/feature/broken-a/README.md'], ErrorOutput, '', 1).error, 'InvalidData');
})));

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('packed PR export compares the actual target and serves a safe static review under a subpath', async () => {
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
 let browser: Browser | undefined;
 try {
  server.listen(0,'127.0.0.1');await once(server,'listening');const address = server.address();assert.ok(address && typeof address==='object');
  const executablePath=process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium')?'/run/current-system/sw/bin/chromium':undefined);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  const page=await browser.newPage();const unexpected:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1'||new URL(request.url()).pathname.startsWith('/api/'))unexpected.push(request.url());});
  await page.goto(`http://127.0.0.1:${address.port}/pr/concord/`);
  await expect(page.getByText('release',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'source.ts',exact:true}).click();await expect(page.locator('[data-git-diff]')).toContainText('value = 2');
  await page.getByRole('button',{name:'docs/new.md',exact:true}).click();
  await page.getByRole('button',{name:'变更后',exact:true}).click();await expect(page.getByRole('heading',{name:'After',exact:true})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);assert.equal(await page.evaluate(()=>Reflect.get(window,'previewExecuted')),undefined);
  await page.reload();await expect(page.getByRole('heading',{name:'After',exact:true})).toBeVisible();assert.deepEqual(unexpected,[]);
 } finally {try {await browser?.close();} finally {await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));}}
});
