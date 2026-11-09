// 跨进程保证：OS 锁与互斥——两个真实工作区服务共享唯一Web builder，死租约可恢复且断连等待者退出时不回收活owner。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import type * as NodeHttpTypes from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Schema } from 'effect';
import { runSourceWeb, sourceWebDigest } from '../../src/base/installation/index.ts';
import { acquireFileLease, releaseFileLease } from '../../src/base/publication/index.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { privateSourceInstallation } from '../support/private-source.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

const checkout = fileURLToPath(new URL('../..', import.meta.url));
const installation = pathToFileURL(join(checkout, 'src/base/installation/index.ts')).href;
const Ready = Schema.Struct({ address: Schema.String });
const Receipt = Schema.Struct({ digest: Schema.String, builderPid: Schema.Int, files: Schema.Array(Schema.Struct({ path: Schema.String })) });
const receipt = (path: string) => Schema.decodeUnknownSync(Schema.fromJsonString(Receipt), { onExcessProperty: 'ignore' })(readFileSync(join(path, 'receipt.json'), 'utf8'));
const http = (address: string) => new Promise<{ status: number; body: string; headers: NodeHttpTypes.IncomingHttpHeaders }>((accept, reject) => {
  // A request owns a fresh connection, including after rebuilding cached files.
  const request = get(address, { agent: false }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', data => { body += String(data); });
    response.once('end', () => accept({ status: response.statusCode ?? 0, body, headers: response.headers }));
    response.once('error', reject);
  });
  request.once('error', reject);
});

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'close');
  child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try { await exited; } finally { clearTimeout(deadline); }
}

async function view(root: string, env: NodeJS.ProcessEnv, cli: string): Promise<{ address: string; child: ChildProcess }> {
  const child = spawn(process.execPath, ['--conditions=concord-source', cli, '--root', root, '--json', 'view', '--in-process', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr!.on('data', data => { errors += String(data); });
  try {
    const ready = await new Promise<Schema.Schema.Type<typeof Ready>>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`Source view readiness timed out: ${output}\n${errors}`)), 120_000);
      const exit = (code: number | null) => { clearTimeout(timer); reject(new Error(`Source view exited ${code}: ${output}\n${errors}`)); };
      child.once('error', reject); child.once('exit', exit);
      child.stdout!.on('data', data => {
        output += String(data);
        if (!output.includes('\n')) return;
        try {
          const ready = Schema.decodeUnknownSync(Schema.fromJsonString(Ready), { onExcessProperty: 'ignore' })(output.split('\n')[0]);
          clearTimeout(timer); child.off('exit', exit); accept(ready);
        } catch (cause) { clearTimeout(timer); reject(cause); }
      });
    });
    return { ...ready, child };
  } catch (cause) {
    const failures = [cause];
    try { stopWorkspaceServer(root, cli, env, ['--conditions=concord-source']); }
    catch (cleanup) { failures.push(cleanup); }
    try { await stop(child); } catch (cleanup) { failures.push(cleanup); }
    throw new AggregateError(failures, `Source view startup failed for ${root}`);
  }
}

// @feature docs/engineering/build/architecture.md#从源码运行
test('two real source workspace services share one disk Web build without checkout artifacts', { timeout: 180_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-web-services-'));
  const tool = join(directory, 'tool');
  const cli = privateSourceInstallation(tool);
  // Cache ownership needs real compilers and services, not the entire editor UI.
  // Keep preview, p5 and all publication/HTTP paths from the private installation.
  writeFileSync(join(tool, 'web/main.tsx'), 'document.querySelector("#root")!.textContent = "Web cache fixture";\n');
  const cache = join(directory, 'cache');
  const buildLog = join(directory, 'builds.ndjson');
  const env = { ...process.env, XDG_CACHE_HOME: cache, CONCORD_TEST_WEB_BUILD_LOG: buildLog };
  const native = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/native');
  mkdirSync(join(cache, 'concord'), { recursive: true });
  symlinkSync(native, join(cache, 'concord/native'), 'junction');
  const roots = ['one', 'two'].map(name => {
    const root = join(directory, name); mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'docs/feature/example'), { recursive: true });
    writeFileSync(join(root, 'docs/feature/example/README.md'), '# Example\n');
    return root;
  });
  const handles: Awaited<ReturnType<typeof view>>[] = [];
  const failures: unknown[] = [];
  try {
    const results = await Promise.allSettled(roots.map(async root => { const handle = await view(root, env, cli); handles.push(handle); return handle; }));
    const rejected = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (rejected.length) throw new AggregateError(rejected, 'Source views did not both become ready');
    assert.equal(handles.length, 2);
    const webCache = join(cache, 'concord/web');
    const entries = readdirSync(webCache).filter(name => /^[a-f0-9]{64}$/u.test(name));
    assert.equal(entries.length, 1);
    const published = join(webCache, entries[0]!);
    const build = receipt(published);
    const builds = readFileSync(buildLog, 'utf8').trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ digest: Schema.String, builderPid: Schema.Int })))(line));
    assert.deepEqual(builds, [{ digest: build.digest, builderPid: build.builderPid }], 'exactly one process entered the compiler');
    const before = readFileSync(join(published, 'receipt.json'), 'utf8');
    assert.ok(!handles.some(handle => handle.child.pid === build.builderPid));
    const services = roots.map(root => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ pid: Schema.Int })), { onExcessProperty: 'ignore' })(readFileSync(join(root, '.git/concord/server/current.json'), 'utf8')).pid);
    assert.equal(new Set(services).size, 2, 'the projects own distinct real workspace services');
    assert.ok(!services.includes(build.builderPid), 'the compiler is a separate process from either service');
    for (const handle of handles) {
      const page = await http(handle.address);
      assert.equal(page.status, 200); assert.match(page.body, /<html/iu); assert.doesNotMatch(page.body, /@vite\/client/u);
      const asset = /(?:src|href)="([^"]+\.js)"/u.exec(page.body)?.[1];
      assert.ok(asset, page.body);
      const javascript = await http(new URL(asset, handle.address).href);
      assert.equal(javascript.status, 200); assert.match(javascript.headers['content-type'] ?? '', /javascript/u);
      assert.match(javascript.body, /Web cache fixture/u);
      assert.equal((await http(new URL('/assets/missing.js', handle.address).href)).status, 404);
      assert.equal((await http(new URL('/feature/example', handle.address).href)).status, 200);
      assert.match((await http(new URL('/p5-frame', handle.address).href)).body, /p5/iu);
    }
    assert.equal(readFileSync(join(published, 'receipt.json'), 'utf8'), before, 'both consumers retain the one builder receipt');
    assert.ok(build.files.some(file => file.path === 'p5/runtime.js'));
    assert.ok(build.files.some(file => file.path === 'preview/FONT-LICENSE.html'));
    assert.equal(readdirSync(webCache).some(name => name.endsWith('.lease') || name.startsWith('.')), false, 'builders relinquish leases and private outputs');
    assert.equal(existsSync(join(checkout, 'dist')), false);
    assert.equal(existsSync(join(checkout, 'web/dist')), false);
    assert.equal(existsSync(join(checkout, 'web/preview/dist')), false);
    for (const path of ['dist', 'web/dist', 'web/preview/dist']) assert.equal(existsSync(join(tool, path)), false);
  } catch (cause) { failures.push(cause); } finally {
    // Ask the live product service to stop before releasing its owning View
    // command; killing the owner first can race the server's own finalizers.
    const services = await Promise.allSettled(roots.map(async root => stopWorkspaceServer(root, cli, env, ['--conditions=concord-source'])));
    const views = await Promise.allSettled(handles.map(async handle => stop(handle.child)));
    const cleanup = [...services, ...views].flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    failures.push(...cleanup);
    if (cleanup.length === 0) {
      try { rmSync(directory, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
    }
  }
  if (failures.length) throw new AggregateError(failures, `Source Web fixture failed; directory: ${directory}`);
});

const runBuilder = (root: string, cache: string, digest: string) => new Promise<{ code: number | null; stderr: string }>((accept, reject) => {
  // Exercise the real builder in an independent Bun process, including failed compilation cleanup.
  const builder = new URL('../../src/base/installation/source-web-builder.ts', import.meta.url).href;
  const code = `const nativeRuntime = { cwd: process.cwd(), env: { ...process.env } }; import { runSourceWeb } from ${JSON.stringify(installation)}; import { buildSourceWebArtifact } from ${JSON.stringify(builder)}; await runSourceWeb(buildSourceWebArtifact(process.argv[1], process.argv[2], process.argv[3]), nativeRuntime);`;
  const child = spawn(process.execPath, ['--conditions=concord-source', '--input-type=module', '-e', code, root, cache, digest], { cwd: checkout, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } });
  let stderr = ''; child.stderr.on('data', data => { stderr += String(data); });
  child.once('error', reject); child.once('close', code => accept({ code, stderr }));
});

// @feature docs/engineering/build/architecture.md#从源码运行
test('real builder failure leaves no publication and deletion, corruption and a dead builder lease recover', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-web-recovery-'));
  const root = join(directory, 'source'), cache = join(directory, 'cache');
  const write = (path: string, bytes: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  try {
    mkdirSync(root); symlinkSync(join(checkout, 'node_modules'), join(root, 'node_modules'), 'junction');
    write('package.json', '{"type":"module","dependencies":{}}');
    for (const path of ['bun.lock', 'src/base/installation/source-web-inputs.ts', 'src/base/installation/source-web-cache.ts', 'src/base/installation/source-web-builder.ts']) write(path, '');
    for (const [config, web] of [['vite.source.config.ts', 'web'], ['vite.preview.config.ts', 'web/preview']]) {
      write(config!, `import { defineConfig } from 'vite'; export default defineConfig({root:new URL('./${web}/',import.meta.url).pathname,envDir:false,build:{minify:false}});`);
      write(`${web}/index.html`, '<!doctype html><html><body><script type="module" src="./main.ts"></script></body></html>');
      write(`${web}/main.ts`, 'document.body.textContent = "ready";');
    }
    write('web/p5/runtime.ts', 'globalThis.console.log("p5 ready");');
    write('web/main.ts', 'export const broken = ;');
    const broken = await runSourceWeb(sourceWebDigest(root), nativeRuntime);
    assert.notEqual((await runBuilder(root, cache, broken)).code, 0);
    assert.equal(existsSync(join(cache, broken)), false);
    assert.deepEqual(readdirSync(cache), [], 'failed compilation cleans private temporary and lock');
    write('web/main.ts', 'document.body.textContent = "ready";');
    const digest = await runSourceWeb(sourceWebDigest(root), nativeRuntime);
    const first = await runBuilder(root, cache, digest); assert.equal(first.code, 0, first.stderr);
    const destination = join(cache, digest);
    const initial = receipt(destination);
    write('src/entry/cli/main.ts', 'export const cliOnly = true;');
    write('src/entry/server/main.ts', 'export const serverOnly = true;');
    assert.equal(await runSourceWeb(sourceWebDigest(root), nativeRuntime), digest);
    const reused = await runBuilder(root, cache, digest); assert.equal(reused.code, 0, reused.stderr);
    assert.equal(receipt(destination).builderPid, initial.builderPid, 'CLI and server changes reuse the disk bundle');
    const chunk = initial.files.find(file => /^web\/assets\/.*\.js$/u.test(file.path))!.path;
    const bytes = readFileSync(join(destination, chunk));
    const altered = Buffer.from(bytes); altered[0] = altered[0]! ^ 1; writeFileSync(join(destination, chunk), altered);
    const recovered = await runBuilder(root, cache, digest); assert.equal(recovered.code, 0, recovered.stderr);
    assert.deepEqual(readFileSync(join(destination, chunk)), bytes, 'same-size corruption is detected by content');
    assert.notEqual(receipt(destination).builderPid, initial.builderPid);
    rmSync(destination, { recursive: true });
    mkdirSync(join(cache, `.${digest}-abandoned`));
    writeFileSync(join(cache, `.${digest}-abandoned`, 'partial'), 'unfinished build');
    // A real child publishes the lease and exits without release; the next builder must prove death.
    const publication = pathToFileURL(join(checkout, 'src/base/publication/index.ts')).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `import { acquireFileLease } from ${JSON.stringify(publication)}; acquireFileLease(process.argv[1], process.argv[1], process.argv[2]+'.lease','exclusive','test-web-crash');`, cache, digest]);
    const rebuilt = await runBuilder(root, cache, digest); assert.equal(rebuilt.code, 0, rebuilt.stderr);
    assert.ok(existsSync(join(destination, 'web/index.html')));
    assert.deepEqual(readdirSync(cache), [digest]);
    write('web/main.ts', 'document.body.textContent = "changed Web input";');
    const changed = await runSourceWeb(sourceWebDigest(root), nativeRuntime);
    assert.notEqual(changed, digest);
    const recompiled = await runBuilder(root, cache, changed); assert.equal(recompiled.code, 0, recompiled.stderr);
    assert.notEqual(receipt(join(cache, changed)).builderPid, receipt(destination).builderPid);
    const changedChunk = receipt(join(cache, changed)).files.find(file => /^web\/assets\/.*\.js$/u.test(file.path))!.path;
    assert.match(readFileSync(join(cache, changed, changedChunk), 'utf8'), /changed Web input/u);
    assert.equal(existsSync(join(root, 'dist')), false);
    assert.equal(existsSync(join(checkout, 'dist')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// @feature docs/engineering/build/architecture.md#从源码运行
test('source builder disconnect interrupts a real lock wait and retains the live owner lease', { timeout: 25_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-web-disconnect-'));
  const cache = join(directory, 'concord/web'), digest = 'a'.repeat(64);
  mkdirSync(cache, { recursive: true });
  const lease = acquireFileLease(cache, cache, `${digest}.lease`, 'exclusive', 'test-web-parent')!;
  let child: ChildProcess | undefined;
  let timer: Awaited<ReturnType<typeof setTimeout>> | undefined;
  let observer: Awaited<ReturnType<typeof watch>> | undefined;
  let diagnostics = '';
  try {
    const attempting = new Promise<void>((accept, reject) => {
      observer = watch(cache, (_event, name) => { if (name?.toString().startsWith(`.${digest}.lease-`)) accept(); });
      observer.once('error', reject);
      timer = setTimeout(() => reject(new Error('Builder did not attempt the real shared-cache lease')), 10_000);
    });
    child = spawn(process.execPath, ['--conditions=concord-source', join(checkout, 'src/entry/web-build/main.ts'), digest, process.cwd()], {
      env: { ...process.env, XDG_CACHE_HOME: directory }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr!.on('data', bytes => { diagnostics += String(bytes); });
    await attempting;
    clearTimeout(timer); observer?.close();
    const closed = once(child, 'exit');
    child.disconnect();
    await Promise.race([closed, new Promise<never>((_accept, reject) => { timer = setTimeout(() => reject(new Error(`Disconnected builder did not exit: ${diagnostics}`)), 4000); })]);
    clearTimeout(timer);
    assert.equal(child.exitCode, 130, 'NodeRuntime completes interrupted scope teardown');
    assert.ok(existsSync(lease.path), 'disconnect cannot reclaim a live writer');
    assert.equal(existsSync(join(cache, digest)), false, 'a waiting builder publishes nothing');
    assert.deepEqual(readdirSync(cache), [`${digest}.lease`]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    observer?.close();
    if (child !== undefined) await stop(child);
    releaseFileLease(lease, 'test-web-parent');
    rmSync(directory, { recursive: true, force: true });
  }
});
