import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/web-workbench/use-case/review-local-changes.md
test('packed view serves its frontend and API without credentials in an isolated Git consumer', async () => {
 const root = consumer('packed-web');
 write(root, 'implementation.ts', 'export const value = "original";\n');
 execFileSync('git', ['-C', root, 'add', "."]);
 execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
 write(root, 'implementation.ts', 'export const value = "staged";\n');
 execFileSync('git', ['-C', root, 'add', 'implementation.ts']);
 write(root, 'implementation.ts', 'export const value = "working";\n');
 const process = spawn(globalThis.process.execPath, [cli, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
 const exited = once(process, 'exit');
 let browser: Browser | undefined;
 try {
  const ready = await new Promise<{address:string;host:string;port:number;local:readonly string[];network:readonly string[]}>((resolveReady, reject) => {
   let buffer='';
   const timer=setTimeout(()=>reject(new Error('Packed view did not become ready')),15000);
   process.once('exit',()=>{clearTimeout(timer);reject(new Error('Packed view exited before readiness'));});
   process.stdout.on('data',(chunk:Buffer)=>{
    buffer+=chunk.toString('utf8');
    const newline=buffer.indexOf('\n'); if(newline<0)return;
    try {const value=Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literal('view'),root:Schema.String,address:Schema.String,host:Schema.String,port:Schema.Int,local:Schema.Array(Schema.String),network:Schema.Array(Schema.String)}),{onExcessProperty:'error'})(JSON.parse(buffer.slice(0,newline)));clearTimeout(timer);resolveReady(value);} catch (cause) { clearTimeout(timer); reject(cause); }
   });
  });
  const help = execFileSync(globalThis.process.execPath, [cli, 'view', '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(help, /key|login|authenticated|密钥/iu);
  const base=ready.address.replace('localhost','127.0.0.1');
  assert.equal(ready.host,'127.0.0.1');
  assert.ok(ready.port > 0);
  assert.deepEqual(ready.local,[base]);
  assert.deepEqual(ready.network,[]);
  const shell=await fetchFresh(base+'feature/accounts');
  assert.equal(shell.status,200);
  const html=await shell.text();
  assert.match(html,/<div id="root"><\/div>/);
  const script=/src="([^"]+\.js)"/.exec(html)?.[1]; assert.ok(script);
  const asset=await fetchFresh(new URL(script,base)); assert.equal(asset.status,200);
  assert.match(asset.headers.get('content-type')??'',/javascript/);
  assert.ok((await asset.arrayBuffer()).byteLength > 0);
  const workspace = await waitForWorkspaceProjection(new URL(base).origin, { timeoutMs: 60_000 });
  assert.ok(workspace.snapshot.root === root);
  assert.equal(workspace.projection.current, false);
  assert.equal((await fetchFresh(base+'api/missing')).status,404);
  assert.equal(call(root,['check'],CheckOutput).ok,true,'idle server must not lock out the CLI');
  const executablePath = globalThis.process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**/api/git', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'GitFailed', message: 'Git fixture unavailable' }) }));
  await page.goto(base);
  await expect(page).toHaveURL(new URL('git', base).href);
  await expect(page.getByRole('alert')).toContainText('Git fixture unavailable');
  await page.unroute('**/api/git');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'implementation.ts', exact: true })).toBeVisible();
  await expect(page.locator('[data-git-diff]')).toContainText('working');
  await page.getByRole('tab', { name: '已暂存', exact: true }).click();
  await expect(page.locator('[data-git-diff]')).toContainText('original');
  await expect(page.locator('[data-git-diff]')).not.toContainText('working');
  await page.reload();
  await expect(page.getByRole('tab', { name: '已暂存', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /文档/ }).click();
  await expect(page.getByRole('button', { name: 'implementation.ts', exact: true })).toHaveCount(0);
 } finally {try {await browser?.close();} finally {process.kill('SIGTERM');await exited;}}
});

// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('installed onboarding creates editable packages and connects supporting-page tests to their Feature', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('onboarding');
 const guide = readFileSync(join(root, 'docs/concord.md'), 'utf8');
 assert.match(guide, /concord test list/);
 assert.match(guide, /a product direction in the same genre as Feature that has not been adopted yet\. Its design is incomplete, or it is designed but not scheduled/u);
 assert.match(guide, /Behavior pages \(Feature README, Use Case, cli, library\) state commands, real human and JSON output, exit codes, and named errors\./u);
 assert.match(guide, /The architecture page states how the Feature is implemented\. Run `concord --skill document` for the full rules\./u);
 for (const path of ['docs/README.md', 'docs/_template/roadmap/use-case/README.md', 'docs/_template/design/README.md', 'docs/_template/engineering/README.md', 'docs/concepts.md', 'docs/architecture.md', 'docs/_template/memory/README.md']) assert.equal(existsSync(join(root, path)), true, path);
 assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /BEGIN CONCORD AGENT INSTRUCTIONS[\s\S]*concord trace gaps --json/u);
 call(root, ['new', 'feature', 'accounts', '--title', 'Accounts', '--pages', 'library,cli,architecture,use-case'], Ack);
 for (const page of ['README.md', 'library.md', 'cli.md', 'architecture.md', 'use-case/README.md']) assert.equal(existsSync(join(root, 'docs/feature/accounts', page)), true, page);
 call(root, ['new', 'feature', 'other', '--title', 'Other'], Ack);
 call(root, ['new', 'engineering', 'ci', '--title', 'Continuous integration'], Ack);
 const page = readPage(root, 'docs/feature/accounts/cli.md');
 savePage(root, 'docs/feature/accounts/cli.md', '# Accounts CLI\n\n## Sign in\n\nReject expired tokens.\n', page.digest);
 assert.equal(savePage(root, 'docs/feature/accounts/cli.md', '# Stale\n', page.digest, 1).error, 'FileChangedSinceRead');
 const ownerBefore = call(root, ['show', 'accounts'], OwnerOutput).document;
 const readme = readPage(root, 'docs/feature/accounts/README.md');
 assert.ok(!readme.body.startsWith('---'));
 savePage(root, 'docs/feature/accounts/README.md', '# Accounts\n\nUsers sign in with valid credentials.\n', readme.digest);
 assert.deepEqual(call(root, ['show', 'accounts'], OwnerOutput).document.metadata, ownerBefore.metadata);
 call(root, ['new', 'issue', 'expired', '--title', 'Expired token'], Ack);
 const annotation = call(root, ['test', 'marker', '--contract', 'docs/feature/accounts/cli.md#sign-in', '--issue', 'docs/issues/expired.md'], AnnotationOutput);
 assert.equal(existsSync(join(root, 'test')), false, 'annotate must not edit test sources');
 write(root, 'test/accounts.test.mjs', `import test from 'node:test';\n${annotation.snippet}test('rejects expired tokens', () => {});\n`);
 const accountCase = deriveTestReference('test/accounts.test.mjs', 'test/accounts.test.mjs', caseDiscriminator('docs/feature/accounts/cli.md#sign-in', 0));
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
 const tracedTest = call(root, ['trace', 'show', 'accounts'], TraceOutput).tests[0];
 assert.ok(tracedTest);
 assert.equal(tracedTest.id, accountCase);
 assert.equal(call(root, ['trace', 'show', 'other'], TraceOutput).tests.length, 0);
 assert.match(callString(root, ['review', 'accounts']), new RegExp(accountCase));
 assert.equal(call(root, ['doctor'], DoctorOutput).cases, 1);
 const human = spawnSync(process.execPath, [cli, '--root', root, 'test', 'list'], { encoding: 'utf8' });
 assert.equal(human.status, 0, human.stderr);
 assert.match(human.stdout, new RegExp(accountCase));
 assert.match(human.stdout, /Contract:/);
 assert.ok(!human.stdout.trimStart().startsWith('{'));
})));
