import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, authorDesignFixture, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, DecisionOutput, MemoryLifecycleOutput, TemplatesOutput, scratch, cli, call, callString, clearDecision, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('installed HawDB caches and current recall work through an installation symlink without Rust or a database helper', () =>
  Effect.runPromise(Effect.gen(function*() {
    const installation = yield* Effect.sync(() => {
      const directory = mkdtempSync(join(scratch, 'private-native-'));
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true }));
      installConcord(directory, packConcord(scratch), [], { private: true });
      return directory;
    });
    const alias = join(scratch, 'opt-concord');
    yield* Effect.sync(() => symlinkSync(join(installation, 'node_modules/concord-sdlc'), alias));
    yield* verifyInstalledNative(alias);
  })));


// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('memory note stays captured and decision activation writes only current fields', () => {
 const root = consumer('memory-note-activation');
 call(root, ['new', 'memory', 'triage-note', '--title', 'Triage note', '--type', 'note'], Ack);
 assert.equal(call(root, ['show', 'memory/triage-note.md'], MemoryLifecycleOutput).document.metadata.status, 'captured');
 assert.equal(call(root, ['memory', 'activate', 'triage-note', '--reason', 'Classify'], ErrorOutput, '', 1).error, 'InvalidMemoryState');
 call(root, ['new', 'memory', 'choice', '--title', 'Choice', '--type', 'decision'], Ack);
 call(root, ['memory', 'activate', 'choice', '--reason', 'Adopt'], Ack);
 assert.equal(call(root, ['show', 'memory/choice.md'], MemoryLifecycleOutput).document.metadata.status, 'current');
 assert.doesNotMatch(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /epoch:|history:|createdAt:/);
});

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

// @use-case docs/feature/document-packages/use-case/organize-freeform-research.md
test('packed Research creates only its title and edits arbitrary nested supporting Markdown', () => {
 const root = consumer('research-package');
 const created = call(root, ['new', 'research', 'notes', '--title', 'My notes'], Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(created.changedPaths, ['docs/research/notes/README.md']);
 const owner = parseDocumentRecord('docs/research/notes/README.md', readFileSync(join(root, 'docs/research/notes/README.md'), 'utf8'))!;
 assert.equal(owner.body.trim(), '# My notes');
 write(root, 'docs/research/notes/材料/比较.md', '# 比较\n');
 const page = readPage(root, 'docs/research/notes/材料/比较.md');
 assert.equal(page.body.trim(), '# 比较');
 savePage(root, 'docs/research/notes/材料/比较.md', '# 任意结构\n\n自由正文。\n', page.digest);
 assert.equal(readFileSync(join(root, 'docs/research/notes/材料/比较.md'), 'utf8'), '# 任意结构\n\n自由正文。\n');
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
});
