import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { packConcord, installConcord } from './installed-package.js';

// An actual external TypeScript stdio program. It imports no Concord library;
// governance signing is delegated to the engine argv supplied by this request.
const adapterSource = `import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
type Receipt = { executor: {name:string;version:string}; repo:string; argv:string[]; checkout:string; files:string[]; cases:never[]; unassignedCases:never[]; bodyExecutions:0; forbiddenSetupExecutions:0; findings:string[]; digest:string; exit:0; signal:null };
type Workspace = { checkout:string; repos:{id:string;receipts:Receipt[]}[]; files:string[];cases:never[];unassignedCases:never[];findings:string[];digest:string };
type Request = {format:string;requestId:string;root:string;engine:{argv:[string,...string[]];implementationDigest:string};processGroup:{leaderPid:number};op:string;payload:{suiteId?:string;checkout?:string;inventoryId?:string;selector?:string;id?:string}};
const request = JSON.parse(readFileSync(0,'utf8')) as Request;
if (request.format !== 'concord.repository-adapter/v1' || request.root !== process.cwd() || request.processGroup.leaderPid !== process.pid || Object.keys(process.env).some(key=>key.startsWith('GIT_') || key==='NODE_TEST_CONTEXT' || key==='CONCORD_UNLISTED_SECRET')) process.exit(71);
writeFileSync('adapter-started.json', JSON.stringify({pid:process.pid,leader:request.processGroup.leaderPid,envNames:Object.keys(process.env)}));
const mode = readFileSync('mode','utf8');
if (mode === 'nonzero') { process.stderr.write('adapter diagnostics'); process.exit(23); }
if (mode === 'stderr-hang') { process.on('SIGTERM',()=>{}); process.stderr.write('x'.repeat(1024*1024+1)); setInterval(()=>{},1000); }
else if (mode === 'hang' || mode === 'leftover') {
  const child = spawn(process.execPath,['-e','process.on("SIGTERM",()=>{}); process.send(process.pid); setInterval(()=>{},1000)'],{stdio:['ignore','ignore','ignore','ipc']});
  child.once('message', pid => { writeFileSync('nested-pid',String(pid)); child.disconnect(); if (mode === 'leftover') respond(); });
  if (mode === 'hang') { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); }
} else respond();
function engine<A>(op:string,payload:object):A {
  const response = JSON.parse(execFileSync(request.engine.argv[0],request.engine.argv.slice(1),{cwd:request.root,env:process.env,input:JSON.stringify({format:'concord.repository-engine/v1',requestId:request.requestId,op,payload}),encoding:'utf8',timeout:20000})) as {format:string;requestId:string;op:string;implementationDigest:string;result:A};
  if (response.format!=='concord.repository-engine/v1' || response.requestId!==request.requestId || response.op!==op || response.implementationDigest!==request.engine.implementationDigest) throw new Error('engine binding');
  return response.result;
}
function respond():void {
  let result:unknown;
  let guards:{path:string;digest:string}[]=[];
  if (request.op.startsWith('collect-')) {
    // This fixture has an empty suite: no invented native execution or evidence.
    const receipt = engine<Receipt>('inventory',{kind:'case',action:'sign',value:{executor:{name:'empty-fixture',version:'1'},repo:'suite',argv:[process.execPath,'adapter.ts'],checkout:request.payload.checkout,files:[],cases:[],unassignedCases:[],bodyExecutions:0,forbiddenSetupExecutions:0,findings:[],exit:0,signal:null}});
    result = engine<Workspace>('inventory',{kind:'workspace',action:'sign',value:{ checkout:request.payload.checkout,repos:[{id:'suite',receipts:[receipt]}],files:[],cases:[],unassignedCases:[],findings:[]}});
    writeFileSync('captured-receipt.json',JSON.stringify(receipt));
    if (mode === 'changed') writeFileSync('implementation.txt',readFileSync('implementation.txt','utf8')+'changed');
  } else if (request.op==='read-inventory') {
    const path='captured-receipt.json';
    result=JSON.parse(readFileSync(path,'utf8')) as unknown;
    guards=[{path,digest:'sha256:'+createHash('sha256').update(readFileSync(path)).digest('hex')}];
    if(mode==='empty-guards') guards=[];
    if(mode==='bad-guard') guards[0]!.digest='sha256:'+'0'.repeat(64);
    if(mode==='escape-guard') guards[0]!.path='../outside.json';
    if(mode==='symlink-guard') guards[0]!.path='linked-receipt.json';
    if(mode==='conflicting-guards') guards.push({path,digest:'sha256:'+'0'.repeat(64)});
  } else if (request.op==='read-red' || request.op==='read-takeover') {
    const path=request.op==='read-red'?'red.json':'takeover.json';
    const evidence=JSON.parse(readFileSync(path,'utf8')) as {id:string;candidatePath:string;receipt?:{candidate:{sha256:string}};receipts?:{key:string;receipt:{candidate:{sha256:string}}}[]};
    evidence.id=request.payload.id!;
    result=evidence;
    guards=[path,'candidate.txt'].map(path=>({path,digest:'sha256:'+createHash('sha256').update(readFileSync(path)).digest('hex')}));
    if(mode==='unguarded-candidate') evidence.candidatePath='unguarded.txt';
    if(mode==='candidate-sha') { if(evidence.receipt) evidence.receipt.candidate.sha256='0'.repeat(64); else evidence.receipts![0]!.receipt.candidate.sha256='0'.repeat(64); }
    if(mode==='duplicate-receipt') evidence.receipts!.push(evidence.receipts![0]!);
  } else throw new Error('unsupported fixture op');
  const response:Record<string,unknown>={format:'concord.repository-adapter/v1',requestId:request.requestId,root:request.root,op:request.op,engineDigest:request.engine.implementationDigest,result,guards};
  if(mode==='request-id') response.requestId='other';
  if(mode==='root') response.root=join(request.root,'other');
  if(mode==='engine') response.engineDigest='sha256:'+'0'.repeat(64);
  if(mode==='op') response.op='read-red';
  if(mode==='unknown') response.extra=true;
  if(mode==='error-envelope') {delete response.result;response.error='failed';}
  if(mode==='result-unknown') (response.result as Record<string,unknown>).extra=true;
  if(mode==='findings-object') (response.result as Record<string,unknown>).findings=[{message:'bad'}];
  if(mode==='stderr-limit') process.stderr.write('x'.repeat(1024*1024+1));
  if(mode==='stdout-limit') {process.stdout.write('x'.repeat(32*1024*1024+1));return;}
  if(mode==='invalid-utf8') {process.stdout.write(Buffer.from([0xff]));return;}
  if(mode==='array-budget') response.result={items:Array(50001).fill(null)};
  if(mode==='node-budget') response.result={items:Array.from({length:4},()=>Array(50000).fill(null))};
  let json=JSON.stringify(response);
  if(mode==='duplicate') json=json.replace('{','{"requestId":"duplicate",');
  if(mode==='tail') json+=' extra';
  process.stdout.write(json);
  if(mode==='leftover') process.exit(0);
}
`;

// The probe is a TypeScript consumer of the packed public module, allowing read
// and guard capture to be exercised without fabricating native regression proof.
const probeSource = `import { Effect } from 'effect';
import { readManagedInventoryReceipt, readManagedRedEvidence, readManagedTakeoverEvidence } from 'concord-sdlc/repository/host';
import { captureRepositoryAdapterGuards, validateRepositoryAdapterGuards } from 'concord-sdlc/repository/process-adapter';
import { writeFileSync } from 'node:fs';
const root=process.cwd();
const operation=process.argv.includes('red')?readManagedRedEvidence(root,'red-fixture'):process.argv.includes('takeover')?readManagedTakeoverEvidence(root,'takeover-fixture'):readManagedInventoryReceipt(root,'fixture','suite/empty.ts#fixture');
Effect.runPromise(captureRepositoryAdapterGuards(operation).pipe(Effect.flatMap(captured=>Effect.try(()=>{
  if(!Object.isFrozen(captured.value)||!Object.isFrozen(captured.guards))throw new Error('unfrozen capture');
  if('receipts' in captured.value){let immutable=false;try{(captured.value.receipts as Map<string,unknown>).clear();}catch{immutable=true;}if(!immutable)throw new Error('mutable receipts');}
  validateRepositoryAdapterGuards(root,captured.guards);
  if(process.argv.includes('drift')){writeFileSync('captured-receipt.json','changed');validateRepositoryAdapterGuards(root,captured.guards);}
  return {guards:captured.guards};
})))).then(value=>process.stdout.write(JSON.stringify(value)),cause=>{process.stderr.write(String(cause)+' '+String(cause?.cause ?? ''));process.exitCode=1;});
`;

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('packed repository CLI binds process requests, rejects invalid responses and reaps nested groups', { timeout: 180_000 }, async t => {
  await Effect.runPromise(Effect.sync(() => {
    const scratch = mkdtempSync(join(tmpdir(), 'concord-process-adapter-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const packed = packConcord(scratch);
    const root = join(scratch, 'consumer');
    mkdirSync(join(root, 'suite'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'process-consumer', private: true, type: 'module' }));
    installConcord(root, packed, ['effect@4.0.0-rc.112']);
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n.repo-tools/\n');
    writeFileSync(join(root, 'suite/empty.ts'), 'export {};\n');
    writeFileSync(join(root, 'adapter.ts'), adapterSource);
    writeFileSync(join(root, 'probe.ts'), probeSource);
    writeFileSync(join(root, 'implementation.txt'), 'original');
    writeFileSync(join(root, 'mode'), 'ok');
    const config = (timeoutMs = 30_000) => ({
      format: 'concord.repository/v2', suites: [{ id: 'suite', root: 'suite' }], historyPath: 'history.ts', policy: 'concord.native-reliability/v1',
      adapter: { argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts', 'implementation.txt', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], implementationRoots: [], envNames: [], timeoutMs },
    });
    const configure = (timeoutMs = 30_000) => writeFileSync(join(root, 'concord.repository.json'), JSON.stringify(config(timeoutMs)));
    configure();
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'consumer']);
    const cli = join(root, 'node_modules/concord-sdlc/dist/entry.js');
    const inventory = () => spawnSync(process.execPath, [cli, 'repo', 'docs', 'test', 'inventory', '--repo', 'suite', '--checkout', 'HEAD', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, CONCORD_UNLISTED_SECRET: 'not-inherited' },
    });
    const positive = inventory();
    assert.equal(positive.status, 0, positive.stderr);
    assert.equal((JSON.parse(positive.stdout) as { caseCount: number }).caseCount, 0);
    const started = JSON.parse(readFileSync(join(root, 'adapter-started.json'), 'utf8')) as { pid: number; leader: number; envNames: string[] };
    assert.equal(started.pid, started.leader);
    // macOS Node may insert this runtime key even when spawned with env: {}.
    const runtimeEnvNames = process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [];
    assert.deepEqual(started.envNames.filter(name => !runtimeEnvNames.includes(name)), []);
    assert.equal(started.envNames.some(name => name.startsWith('GIT_') || name === 'NODE_TEST_CONTEXT' || name === 'CONCORD_UNLISTED_SECRET'), false);
    assert.equal(existsSync(join(root, 'node_modules/@niceeval')), false);

    // Public identity binds the recursive implementation closure, including
    // additions and dependency declarations, without executing the adapter.
    const identity = () => spawnSync(process.execPath, [cli, 'repo', 'engine', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 20_000,
      input: JSON.stringify({ format: 'concord.repository-engine/v1', requestId: 'closure', op: 'identity', payload: {} }),
    });
    const digest = () => {
      const result = identity();
      assert.equal(result.status, 0, result.stderr);
      return (JSON.parse(result.stdout) as { result: { adapterDigest: string } }).result.adapterDigest;
    };
    mkdirSync(join(root, 'implementation-root'));
    writeFileSync(join(root, 'implementation-root/base.ts'), 'export const value = 1;');
    writeFileSync(join(root, 'concord.repository.json'), JSON.stringify({ ...config(), adapter: { ...config().adapter, implementationRoots: ['implementation-root'] } }));
    const originalIdentity = digest();
    writeFileSync(join(root, 'implementation-root/added.ts'), 'export const added = true;');
    assert.notEqual(digest(), originalIdentity);
    rmSync(join(root, 'implementation-root/added.ts'));
    assert.equal(digest(), originalIdentity);
    mkdirSync(join(root, 'implementation-root/node_modules'));
    writeFileSync(join(root, 'implementation-root/node_modules/ignored.ts'), 'ignored installed dependency');
    assert.equal(digest(), originalIdentity);
    symlinkSync(join(root, 'implementation.txt'), join(root, 'implementation-root/link.ts'));
    assert.equal(identity().status, 1, 'implementation symlinks must fail');
    rmSync(join(root, 'implementation-root/link.ts'));
    const lockBytes = readFileSync(join(root, 'pnpm-lock.yaml'));
    writeFileSync(join(root, 'pnpm-lock.yaml'), Buffer.concat([lockBytes, Buffer.from('\n# changed dependency binding\n')]));
    assert.notEqual(digest(), originalIdentity);
    writeFileSync(join(root, 'pnpm-lock.yaml'), lockBytes);
    assert.equal(digest(), originalIdentity);
    configure();

    for (const mode of ['request-id', 'root', 'engine', 'op', 'unknown', 'error-envelope', 'result-unknown', 'findings-object', 'duplicate', 'tail', 'invalid-utf8', 'array-budget', 'node-budget', 'nonzero', 'stderr-limit', 'stdout-limit', 'changed']) {
      writeFileSync(join(root, 'mode'), mode);
      const result = inventory();
      assert.equal(result.status, 1, `${mode}: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /RepositoryAdapter(?:Invalid|Failed|Changed)/u, mode);
      assert.equal(result.stdout, '', mode);
    }
    writeFileSync(join(root, 'mode'), 'stderr-hang');
    const stderrStartedAt = Date.now();
    const stderrHung = inventory();
    assert.equal(stderrHung.status, 1, stderrHung.stderr);
    assert.match(stderrHung.stderr, /RepositoryAdapterFailed/u);
    assert.ok(Date.now() - stderrStartedAt < 15_000, 'stderr overflow must stop the group before the 30s request timeout');

    writeFileSync(join(root, 'mode'), 'ok');
    const probe = (...args: string[]) => spawnSync(process.execPath, ['probe.ts', ...args], { cwd: root, encoding: 'utf8', timeout: 45_000 });
    const firstProbe = probe();
    assert.equal(firstProbe.status, 0, firstProbe.stderr);
    symlinkSync('captured-receipt.json', join(root, 'linked-receipt.json'));
    for (const mode of ['empty-guards', 'bad-guard', 'escape-guard', 'symlink-guard', 'conflicting-guards']) {
      writeFileSync(join(root, 'mode'), mode);
      const result = probe();
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /RepositoryAdapterInvalid/u, mode);
    }
    writeFileSync(join(root, 'mode'), 'ok');
    const drift = probe('drift');
    assert.equal(drift.status, 1, drift.stdout);
    assert.match(drift.stderr, /PreimageChanged/u);

    // These signed values exercise wire/candidate checks only. No regression
    // relation or fixed conclusion is requested from these transport fixtures.
    rmSync(join(root, 'linked-receipt.json'));
    mkdirSync(join(root, 'docs/feature/fixture'), { recursive: true });
    writeFileSync(join(root, 'docs/feature/fixture/README.md'), '---\nformat: concord.document/v1\nkind: feature\nid: fixture\ntitle: Fixture\ncreatedAt: 2026-09-14T00:00:00.000Z\n---\n# Fixture\n');
    writeFileSync(join(root, 'suite/guard.test.ts'), 'import {test} from "node:test";\n// @feature docs/feature/fixture/README.md\ntest("guard fixture",()=>{});\n');
    const engine = <A>(op: string, payload: object): A => {
      const output = spawnSync(process.execPath, [cli, 'repo', 'engine', '--json'], { cwd: root, encoding: 'utf8', timeout: 30_000, input: JSON.stringify({ format: 'concord.repository-engine/v1', requestId: 'fixture', op, payload }) });
      assert.equal(output.status, 0, output.stderr);
      return (JSON.parse(output.stdout) as { result: A }).result;
    };
    const caseId = engine<string>('case-id', { nativePath: 'suite/guard.test.ts', declarationPath: 'suite/guard.test.ts', title: 'guard fixture' });
    const selector = `suite/guard.test.ts#${caseId}`;
    const source = engine<unknown>('source', { selector });
    writeFileSync(join(root, 'candidate.txt'), 'candidate');
    const candidateSha256 = createHash('sha256').update('candidate').digest('hex');
    const receipt = engine<unknown>('receipt', { action: 'sign', value: {
      format: 'concord.native-case-receipt/v1', mode: 'formal', observation: 'red', selector, caseId, inventoryDigest: `sha256:${'0'.repeat(64)}`,
      problem: { path: 'memory/fixture.md', epoch: 0 }, candidate: { gitSha: '0'.repeat(40), sha256: candidateSha256, sri: `sha256-${Buffer.from(candidateSha256, 'hex').toString('base64')}` }, source,
      runner: { executor: 'transport-fixture', version: '1', implementationDigest: `sha256:${'0'.repeat(64)}`, argv: [] },
      result: { disposition: 'regression', stage: 'test', exitCode: 1, signal: null, timedOut: false, startupFailed: false },
      native: { copyId: 'fixture', copyPath: root, sequence: 1, mode: 'single', caseCount: 1, passed: 0, failed: 1, skipped: 0, retries: 0, parallelism: 1 },
      cleanup: { ok: true, resources: [] }, invocationId: 'transport-fixture',
    } });
    const certificate = engine<unknown>('certificate', { action: 'sign', value: {
      format: 'concord.native-reliability/v1', selector, caseId, candidateSha256, sourceDigest: '0'.repeat(64), greenReceipt: 'green.json',
      observations: { isolatedCopies: ['a.json', 'b.json', 'c.json'], sameCopy: ['d.json', 'e.json'], defaultParallel: 'parallel.json', singleCase: 'green.json', cleanup: [] },
    } });
    writeFileSync(join(root, 'red.json'), JSON.stringify({ id: 'red-fixture', receipt, candidatePath: 'candidate.txt' }));
    writeFileSync(join(root, 'takeover.json'), JSON.stringify({ id: 'takeover-fixture', certificate, receipts: [{ key: 'green.json', receipt }], candidatePath: 'candidate.txt' }));
    for (const operation of ['red', 'takeover']) {
      writeFileSync(join(root, 'mode'), 'ok');
      const valid = probe(operation);
      assert.equal(valid.status, 0, valid.stderr);
      for (const mode of ['unguarded-candidate', 'candidate-sha', ...(operation === 'takeover' ? ['duplicate-receipt'] : [])]) {
        writeFileSync(join(root, 'mode'), mode);
        const invalid = probe(operation);
        assert.equal(invalid.status, 1, `${operation}: ${mode}`);
        assert.match(invalid.stderr, /RepositoryAdapterInvalid/u);
      }
    }

    // Fault only the OS observation boundary. Real adapters still run, and a
    // second capability must fail before another process can start.
    writeFileSync(join(root, 'mode'), 'ok');
    writeFileSync(join(root, 'cleanup-probe.ts'), `import {Cause,Effect,Exit} from 'effect';
import {readFileSync} from 'node:fs';
import {collectWorkspaceCaseInventory} from 'concord-sdlc/repository/host';
const kill=process.kill;process.kill=(pid,signal)=>{if(pid<0&&signal===0)throw Object.assign(new Error('injected observation failure'),{code:'EPERM'});return kill(pid,signal);};
const run=()=>Effect.runPromise(Effect.exit(collectWorkspaceCaseInventory('HEAD')));
const first=await run();const started=readFileSync('adapter-started.json','utf8');const second=await run();
if(!Exit.isFailure(first)||!Exit.isFailure(second)||!Cause.pretty(first.cause).includes('RepositoryAdapterCleanupUnknown')||!Cause.pretty(second.cause).includes('RepositoryAdapterCleanupUnknown')||readFileSync('adapter-started.json','utf8')!==started)throw new Error('cleanup failure did not latch');
`);
    const cleanupProbe = spawnSync(process.execPath, ['cleanup-probe.ts'], { cwd: root, encoding: 'utf8', timeout: 45_000 });
    assert.equal(cleanupProbe.status, 0, cleanupProbe.stderr);

    // Both adapter and nested child ignore TERM. The sole outer owner must KILL
    // the complete inherited group; a clean leader exit with leftovers fails too.
    for (const mode of ['hang', 'leftover']) {
      configure(mode === 'hang' ? 1000 : 30_000);
      writeFileSync(join(root, 'mode'), mode);
      rmSync(join(root, 'nested-pid'), { force: true });
      const result = inventory();
      assert.equal(result.status, 1, `${mode}: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /RepositoryAdapterFailed/u);
      assert.equal(existsSync(join(root, 'nested-pid')), true, `${mode}: nested child must have started`);
      const pid = Number(readFileSync(join(root, 'nested-pid'), 'utf8'));
      const observed = spawnSync(process.execPath, ['--input-type=module', '-e', `import {observeOwnedProcessGroup} from 'concord-sdlc/owned-process'; process.stdout.write(observeOwnedProcessGroup(${Number(JSON.parse(readFileSync(join(root, 'adapter-started.json'), 'utf8')).pid)}));`], { cwd: root, encoding: 'utf8' });
      assert.equal(observed.status, 0, observed.stderr);
      assert.ok(['gone', 'zombie-only'].includes(observed.stdout), `${mode}: group remains ${observed.stdout}; nested PID ${pid}`);
    }

    // Preserve the module-host route, including its independent engine check.
    configure();
    const { adapter: _adapter, ...base } = config();
    writeFileSync(join(root, 'concord.repository.json'), JSON.stringify({ ...base, host: 'host.ts' }));
    writeFileSync(join(root, 'host.ts'), `import {Effect} from 'effect'; import {evidenceSignature} from 'concord-sdlc/evidence-policy'; export default {format:'concord.repository-host/v2',caseIdentity:'concord.case-contracts/v1',repositoryRoot:process.cwd(),managedInventoryImplementationDigest:()=>Effect.succeed('sha256:'+'0'.repeat(64)),collectRepoCaseInventory:(_suite:string,checkout:string)=>Effect.sync(()=>{const unsigned={ checkout,repos:[],files:[],cases:[],unassignedCases:[],findings:[]}; return {...unsigned,digest:'sha256:'+evidenceSignature(unsigned)};})};`);
    const legacy = inventory();
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal((JSON.parse(legacy.stdout) as { caseCount: number }).caseCount, 0);
  }));
});
