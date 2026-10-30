import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, authorDesignFixture, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, DecisionOutput, MemoryLifecycleOutput, TemplatesOutput, scratch, cli, call, callString, clearDecision, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name packed-operation-boundaries
test('packed local operations isolate unrelated malformed contracts and check reports all failures', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('operation-boundaries');
 call(root, ['new', 'feature', 'target', '--title', 'Target'], Ack);
 call(root, ['new', 'feature', 'broken-a', '--title', 'Broken A'], Ack);
 call(root, ['new', 'feature', 'broken-b', '--title', 'Broken B'], Ack);
 for (const id of ['broken-a', 'broken-b']) write(root, `docs/feature/${id}/README.md`, '---\nformat: concord.document/v1\nkind: feature\n---\n# Incomplete owner\n');
 const target = 'docs/feature/target/README.md';
 assert.match(call(root, ['code', 'annotate', '--scope', 'file', '--contract', target], AnnotationOutput).snippet, /@concord-implements docs\/feature\/target\/README.md/u);
 assert.match(call(root, ['test', 'annotate', '--contract', target], AnnotationOutput).snippet, /@feature docs\/feature\/target\/README.md/u);
 call(root, ['new', 'memory', 'repair-note', '--title', 'Repair note', '--type', 'note'], Ack);
 const index = call(root, ['memory', 'index'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })) }));
 const note = index.documents.find(record => record.path === 'memory/repair-note.md');
 assert.ok(note);
 call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path: note.path, body: '---\ntype: note\nstatus: captured\n---\n\n# Repair note\n\nObserved broken contract metadata.\n', expectedDigest: note.digest }));
 const recalled = call(root, ['memory', 'recall', 'broken contract'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ body: Schema.String })) }));
 assert.equal(recalled.documents.length, 1);
 assert.match(recalled.documents[0]!.body, /Observed broken contract metadata/u);
 const listed = call(root, ['list', 'memory'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) }));
 assert.equal(listed.documents[0]?.id, 'repair-note');
 call(root, ['new', 'issue', 'repair-observation', '--title', 'Repair observation'], Ack);
 assert.equal(call(root, ['list', 'issue'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) })).documents[0]?.id, 'repair-observation');
 const checked = call(root, ['check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String })) }), '', 1);
 assert.equal(checked.ok, false);
 for (const id of ['broken-a', 'broken-b']) assert.ok(checked.findings.some(finding => finding.path === `docs/feature/${id}/README.md`));
 assert.equal(call(root, ['code', 'annotate', '--scope', 'file', '--contract', 'docs/feature/broken-a/README.md'], ErrorOutput, '', 1).error, 'InvalidData');
})));

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('packed PR export compares the actual target and serves a safe static review under a subpath', async () => {
 const root = join(scratch, 'pr-export'); mkdirSync(root);
 const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
 git('init', '-q', '-b', 'release'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
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
 const { decodeChangePreview } = await import(pathToFileURL(createRequire(cli).resolve('concord-sdlc/change-preview')).href) as typeof import("../../src/model/change-preview.js");
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


// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('packed writing checks consumer policy, readable prose and safe input boundaries while excluding SVG', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('writing');
 const reportSchema = Schema.Struct({ ok: Schema.Boolean, files: Schema.Int, findings: Schema.Array(Schema.Struct({ file: Schema.String, line: Schema.Int, rule: Schema.String, message: Schema.String })) });
 const policy = {
  format: 'concord.writing/v3', roots: ['guide', 'guide/page.md'],
  bannedTerms: [{ term: 'bad', use: 'clear', why: 'Be precise', exempt: ['guide/exempt'] }, { term: '旧词', use: '新词', why: 'One vocabulary', allowIn: ['旧词典'] }],
  sentenceLength: 20, paragraphLength: 30, unusedConcepts: true,
 };
 mkdirSync(join(root, 'guide'));
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(policy));
 writeFileSync(join(root, 'guide/style.css'), '.label { fill: black; }\n');
 writeFileSync(join(root, 'docs/concepts.md'), "---\ndeprecated:\n  new-word:\n    - 旧称\n---\n\n# Terms\n\n## 新词 {#new-word}\n\nPreferred wording\n");
 writeFileSync(join(root, 'guide/page.md'), [
  '---', 'title: bad', '---', '# Guide', '', '新词 good 旧词典.', '',
  '```ts', 'bad', '```', '', '~~~', 'bad', '~~~', '',
  '``bad ` bad`` [clear](bad) ![bad](image.png)', '', '<!-- bad -->', '',
  'bad BAD badly 旧词 旧称', '', '甲'.repeat(15), '乙'.repeat(20) + '。',
 ].join('\n'));
 writeFileSync(join(root, 'guide/view.mdx'), ['<Panel', ' title="bad"', '>', 'clear', '</Panel>', '{/* GENERATED:BEGIN fields */}', 'bad', '{/* GENERATED:END fields */}'].join('\n'));
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text><desc>bad</desc></svg>');
 const first = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert.equal(first.files, 2);
 assert(first.findings.filter(hit => hit.rule === 'bannedTerm').length >= 4);
 assert.equal(first.findings.filter(hit => hit.rule === 'sentenceLength').length, 1);
 assert.equal(first.findings.filter(hit => hit.rule === 'paragraphLength').length, 1);
 assert(first.findings.some(hit => hit.file === 'guide/page.md' && hit.line === 22));
 assert(!first.findings.some(hit => hit.rule === 'unusedConcept' || hit.rule === 'svgTerm' || hit.rule === 'svgStyle'));
 writeFileSync(join(root, 'guide/page.md'), '新词 good 旧词典.\n');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text></svg>');
 assert.equal(call(root, ['docs', 'check'], reportSchema).ok, true);
 mkdirSync(join(root, 'guide/exempt-more'));
 writeFileSync(join(root, 'guide/exempt-more/page.md'), 'bad');
 assert(call(root, ['docs', 'check'], reportSchema, '', 1).findings.some(hit => hit.file === 'guide/exempt-more/page.md'));
 rmSync(join(root, 'guide/exempt-more'), { recursive: true });
 writeFileSync(join(root, 'guide/page.md'), 'clear');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><text class="label">幽灵</text></svg>');
 const missing = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert(missing.findings.some(hit => hit.rule === 'unusedConcept'));
 assert(!missing.findings.some(hit => hit.file.endsWith('.svg')));
 for (const invalid of [{ ...policy, svgTerms: false }, { ...policy, svgStyle: null }, { ...policy, unknown: true }, { ...policy, roots: ['../outside'] }, { ...policy, bannedTerms: [{ term: 'bad', use: '', why: 'reason' }] }]) {
  writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(invalid));
  assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 }
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ ...policy, svgTerms: false, svgStyle: null }));
 const obsolete = call(root, ['writing', 'show'], Schema.Struct({ state: Schema.String, digest: Schema.String, source: Schema.String }));
 assert.equal(obsolete.state, 'invalid');
 writeFileSync(join(root, 'clean-policy.json'), JSON.stringify(policy));
 call(root, ['--dry-run', 'writing', 'set', '--body', join(root, 'clean-policy.json'), '--expected-digest', obsolete.digest], DryRunOutput);
 assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), obsolete.source);
 call(root, ['writing', 'set', '--body', join(root, 'clean-policy.json'), '--expected-digest', obsolete.digest], Ack);
 assert.deepEqual(JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')), policy);
 writeFileSync(join(root, 'svg-action.json'), JSON.stringify({ action: 'writing.set', policy: { ...policy, svgTerms: false }, expectedDigest: obsolete.digest }));
 call(root, ['action', '--input', join(root, 'svg-action.json')], ErrorOutput, '', 1);
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ ...policy, roots: ['missing'] }));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'WritingInputNotFound');
 writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'UnsafePath');
 assert.equal(call(root, ['docs', 'check', '--rules', 'absent.json'], ErrorOutput, '', 1).error, 'WritingPolicyNotFound');
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed scoped owner commands use path, Markdown catalog body, null creation CAS, and standalone rules', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('scoped-owner-cli');
 write(root, 'docs/feature/sample/page.md', 'Feedback.\n');
 write(root, 'policy.json', JSON.stringify({ format: 'concord.writing/v3', bannedTerms: [] }));
 write(root, 'catalog.md', "# Terms\n\n## Feedback {#feedback}\n\nA response\n");
 const ownerPath = 'docs/feature/sample/concord-writing.json';
 const catalogPath = 'docs/feature/sample/concepts.md';
 assert.equal(call(root, ['writing', 'show', '--path', ownerPath], Schema.Struct({ state: Schema.String })).state, 'missing');
 assert.equal(call(root, ['--dry-run', 'writing', 'set', '--path', ownerPath, '--body', join(root, 'policy.json'), '--expected-digest', 'null'], DryRunOutput).dryRun, true);
 assert.equal(existsSync(join(root, ownerPath)), false);
 call(root, ['writing', 'set', '--path', ownerPath, '--body', join(root, 'policy.json'), '--expected-digest', 'null'], DigestOutput);
 call(root, ['concepts', 'set', '--path', catalogPath, '--body', join(root, 'catalog.md'), '--expected-digest', 'null'], DigestOutput);
 assert.equal(call(root, ['concepts', 'show', '--path', catalogPath], Schema.Struct({ state: Schema.String })).state, 'valid');
 assert(call(root, ['writing', 'index'], Schema.Struct({ scopes: Schema.Array(Schema.Struct({ scope: Schema.String })) })).scopes.some(item => item.scope === 'docs/feature/sample'));
 assert(call(root, ['concepts', 'index'], Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String })) })).concepts.some(item => item.reference === catalogPath + '#feedback'));
 assert.equal(call(root, ['writing', 'check', '--path', ownerPath], CheckOutput).ok, true);
 const external = consumer('standalone-owner-cli');
 rmSync(join(external, 'docs/concepts.md'));
 write(external, 'guide/page.md', 'Standalone prose.\n');
 write(external, 'rules.json', JSON.stringify({ format: 'concord.writing/v3', roots: ['guide'], bannedTerms: [] }));
 assert.equal(call(external, ['docs', 'check', '--rules', 'rules.json'], CheckOutput).ok, true);
 write(external, 'docs/concord-writing.json', JSON.stringify({ format: 'concord.writing/v1', roots: ['docs'], bannedTerms: [] }));
 assert.equal(call(external, ['docs', 'check', '--rules', 'rules.json'], CheckOutput).ok, true);
})));
