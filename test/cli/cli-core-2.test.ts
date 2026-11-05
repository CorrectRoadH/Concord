import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('packed HTTP workspace projection reads the shared generation and holds warm budgets', async t => {
 const root = consumer('packed-projection');
 call(root,['new', 'feature','projected','--title','Projected','--pages','architecture'],Ack);
 const server = spawn(globalThis.process.execPath, [cli, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
 const exited = once(server, 'exit');
 try {
  const ready = await new Promise<{address:string}>((resolveReady, reject) => {
   let buffer='';
   const timer=setTimeout(()=>reject(new Error('Packed view did not become ready')),15000);
   server.once('exit',()=>{clearTimeout(timer);reject(new Error('Packed view exited before readiness'));});
   server.stdout.on('data',(chunk:Buffer)=>{
    buffer+=chunk.toString('utf8');
    const newline=buffer.indexOf('\n'); if(newline<0)return;
    try {const value=Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literal('view'),address:Schema.String}),{onExcessProperty:'ignore'})(JSON.parse(buffer.slice(0,newline)));clearTimeout(timer);resolveReady(value);} catch (cause) { clearTimeout(timer); reject(cause); }
   });
  });
  const base=ready.address.replace('localhost','127.0.0.1');
  const initial = await waitForWorkspaceProjection(new URL(base).origin, { timeoutMs: 60_000 });
  let projectionBytes = 0;
  const httpSample = async () => {
   const started = performance.now();
   const response = await fetchFresh(base+'api/workspace');
   const size = (await response.arrayBuffer()).byteLength;
   const ms = performance.now() - started;
   assert.equal(response.status, 200);
   projectionBytes = size;
   return ms;
  };
  await httpSample();
  const httpTimes: number[] = [];
  for (let index = 0; index < 7; index += 1) httpTimes.push(await httpSample());
  httpTimes.sort((a, b) => a - b);
  const percentile = (sorted: readonly number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
  const httpP50 = percentile(httpTimes, 0.5), httpP95 = percentile(httpTimes, 0.95);
  t.diagnostic(`workspace projection: docs=${initial.snapshot.documents.length} pages=${initial.snapshot.pages.length} bytes=${projectionBytes} native=${HAWDB_REVISION} node=${process.version} ${process.platform}-${process.arch}`);
  t.diagnostic(`HTTP warm p50=${httpP50.toFixed(1)}ms p95=${httpP95.toFixed(1)}ms`);
  assert.ok(httpP50 <= 250, `HTTP warm p50 ${httpP50}ms exceeds 250ms`);
  assert.ok(httpP95 <= 600, `HTTP warm p95 ${httpP95}ms exceeds 600ms`);

 } finally {server.kill('SIGTERM');await exited;}
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('packed CLI rejects Research category and the removed open filter', () => {
 const root = consumer('removed-document-options');
 for (const args of [['new', 'research', 'notes'], ['list', 'research'], ['list', '--open']]) {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 1, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  assert.match(result.stderr, /InvalidInput/u);
 }
 assert.equal(existsSync(join(root, 'docs/research/notes/README.md')), false);
});
