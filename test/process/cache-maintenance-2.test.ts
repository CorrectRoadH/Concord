// 跨进程保证：原生模块与句柄——独立native写入者与维护worker争用不删除活跃缓存，长期服务维护后保留owner并继续受理。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { initialize } from '../support/operations.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { workerEntryArgv, CACHE_MAINTENANCE_THRESHOLD_BYTES } from "../../src/base/installation/index.ts";
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { openHawdb } from "../../src/base/cache/index.ts";

import { pollUntil } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-maintenance-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = (await LocalRepository.open(root, { initialize: true }));
  try { (await initialize(repo, false, { testRoots: [], sourceRoots: [] })); } finally { repo.close(); }
  const path = join(root, '.git/concord/cache.hawdb');
  const db = openHawdb(path, { readOnly: false, create: true }, nativeRuntime);
  db.put('config_cache', [{ key: 'retained', payload: 'a current logical value' }]); db.close();
  return { root, path, privateDir: join(root, '.git/concord'), padding: join(path, 'retained-padding') };
}
function pad(path: string, bytes: number) { writeFileSync(path, ''); truncateSync(path, bytes); }
function worker(root: string) {
  const result = spawnSync(process.execPath, [...workerEntryArgv('cache-maintenance-worker'), root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const read = (path: string) => {
  const db = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
  try { return db.get('config_cache', ['retained', 'concurrent-writer']); } finally { db.close(); }
};
async function settle(root: string) {
  await pollUntil(async () => {
    const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
    return lines.some(line => line.includes('cache-maintenance-worker.') && line.includes(root)) ? undefined : true;
  }, { description: 'detached cache maintenance to exit', timeoutMs: 30_000 });
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('maintenance competing with another process holding and writing a handle exits without deletion', () => Effect.runPromise(Effect.tryPromise({ try: async () => {
  const f = (await fixture());
  let holder: ChildProcess | undefined;
  try {
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES * 2 + 1);
    holder = spawn(process.execPath, [fileURLToPath(new URL('../support/cache-maintenance-holder.ts', import.meta.url)), f.path], { stdio: ['pipe', 'pipe', 'pipe'] });
    const wait = (word: string) => new Promise<void>((resolve, reject) => {
      const proc = holder!;
      let seen = '';
      const timeout = setTimeout(() => reject(new Error(`writer did not emit ${word}`)), 30_000);
      const output = (chunk: Buffer) => { seen += chunk.toString(); if (seen.includes(word)) { clearTimeout(timeout); proc.stdout!.off('data', output); resolve(); } };
      proc.stdout!.on('data', output);
      proc.once('error', reject);
      proc.once('exit', code => { clearTimeout(timeout); reject(new Error(`writer exited ${code}`)); });
    });
    await wait('READY');
    const written = wait('WROTE'); holder.stdin!.write('write\n');
    worker(f.root);
    await written;
    assert.equal(existsSync(f.padding), true);
    await new Promise<void>(resolve => { holder!.once('exit', () => resolve()); holder!.kill('SIGTERM'); });
    holder = undefined;
    assert.equal(read(f.path).find(row => row.key === 'concurrent-writer')?.payload, 'current writer value');
  } finally {
    if (holder !== undefined && holder.exitCode === null) await new Promise<void>(resolve => { holder!.once('exit', () => resolve()); holder!.kill('SIGTERM'); });
    rmSync(f.root, { recursive: true, force: true });
  }
}, catch: cause => cause })));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('a query service maintains an oversized cache while retaining ownership and accepting later queries', () => Effect.runPromise(Effect.tryPromise({ try: async () => {
  const f = (await fixture()), install = join(f.root, 'installation');
  let installedEntry: string | undefined;
  try {
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'maintenance-consumer', private: true, type: 'module' }));
    const entry = sourceCli();
    installedEntry = entry;
    const trace = join(f.root, 'reclamation-trace.jsonl');
    const env = { ...process.env, CONCORD_TEST_RECLAIM_TRACE: trace, BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ''} --preload=${fileURLToPath(new URL('../fixtures/cache-maintenance-preload.ts', import.meta.url))}`.trim() };
    const events = () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { kind: string; pid: number; argv: string[] }) : [];
    const command = (...args: string[]) => spawnSync(process.execPath, [entry, '--root', f.root, '--json', ...args], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
    const rebuild = () => {
      const result = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'cache', 'rebuild'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    rebuild();
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES * 2 + 1);
    const result = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'check'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const owner = JSON.parse(command('server', 'status').stdout);
    assert.equal(owner.state, 'running');
    const ownerPid: unknown = JSON.parse(command('cache', 'status').stdout).pid;
    assert.equal(typeof ownerPid, 'number');
    await pollUntil(async () => events().some(event => event.kind === 'reclaimed' && event.pid === ownerPid) ? true : undefined, { description: 'service-owned oversized cache reclamation', timeoutMs: 45_000 }).catch(cause => { throw new Error(JSON.stringify({ events: events(), status: command('server', 'status').stdout }), { cause }); });
    assert.equal(existsSync(f.padding), true, 'reclamation must preserve data even above the trigger');
    const computations = events().filter(event => event.kind === 'compute-start');
    assert.equal(computations.length, 2, 'reclamation must retain both warm computation processes');
    for (const worker of computations) assert.doesNotThrow(() => process.kill(worker.pid, 0));
    await pollUntil(async () => {
      const status = command('cache', 'status');
      return status.status === 0 && JSON.parse(status.stdout).status === 'ready' ? true : undefined;
    }, { description: 'service reopens its cache after maintenance', timeoutMs: 10_000 });
    assert.equal(JSON.parse(command('server', 'status').stdout).token, owner.token);
    rebuild();
    const rebuilt = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'check'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    assert.equal(JSON.parse(rebuilt.stdout).ok, true);
    assert.equal(existsSync(f.padding), true);
    assert.equal(events().filter(event => event.kind === 'compute-start').length, 2, JSON.stringify(events().filter(event => event.kind === 'compute-start')));
  } finally {
    if (installedEntry) {
      const stopped = spawnSync(process.execPath, [installedEntry, '--root', f.root, '--json', 'server', 'stop'], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
      await pollUntil(async () => existsSync(join(f.privateDir, 'server/current.json')) ? undefined : true, { description: 'maintenance service releases its instance', timeoutMs: 10_000 });
    }
    await settle(f.root); rmSync(f.root, { recursive: true, force: true });
  }
}, catch: cause => cause })));
