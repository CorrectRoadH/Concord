import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { stopWorkspaceServer } from './stop-workspace-server.ts';
import { record, recordPath } from './workspace-server-fixture.ts';
import { connectWorkspaceSocket, requestWorkspace, Snapshot } from '../../src/entry/server/index.ts';
import { readQuery, storeQuery } from './operations.ts';
import { initialize, createDocument } from './operations.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { NodeServices } from '@effect/platform-node';
import { makeOwnedProcessService } from '../../src/base/process/index.ts';
import { installationResources, installationRootForBin } from '../../src/base/installation/index.ts';
import { classifyQueryRefresh, persist } from '../../src/app/index.ts';
import { pathToFileURL } from 'node:url';
import { sourceCli } from './source-consumer.ts';
import { createConsumer } from './consumer.ts';
import { genericPrivateDirectorySync } from "../../src/base/publication/index.ts";
import { refreshQuery } from "../../src/app/index.ts";
import { pollUntil } from './support.ts';
import { decodeDocumentSource } from "../../src/domain/documents/index.ts";
import { workerEntryArgv } from "../../src/base/installation/index.ts";
import { installedConcordCli } from './support.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from './temporary.ts';
import { join, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { sourceRoot, prepareSourceConsumer } from './source-consumer.ts';
import { cacheDatabasePath } from "../../src/base/cache/index.ts";
import { openHawdb } from "../../src/base/cache/index.ts";
import { readProjectConfig, writeProjectConfig } from './support.ts';
import { LocalRepository } from "./repository.ts";

import { setAuthor } from "../../src/domain/documents/index.ts";

import { renderDocument } from "../../src/model/index.ts";
import { ConcordError, digest } from "../../src/model/index.ts";
import { QueryCacheEnvelope, queryContext as identifyQuery, type Query } from "../../src/app/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

export const gaps = (marker = 'original') => ({ operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: [marker], contracts: [], cliPages: [], unmarkedLists: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } });
export const candidate = (marker = 'original', scannedAt = Date.now()) => ({ kind: 'candidate' as const, message: { format: 'concord.query-scan/v1' as const, ok: true as const, scannedAt, finishedAt: Date.now(), value: gaps(marker), complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } } });
export async function consumer(): Promise<string> {
  const root = (await createConsumer());
  writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'sample', title: 'Sample' })); } finally { repo.close(); }
  return root;
}
export const cli = installedConcordCli();
export const call = (root: string, ...args: string[]) => spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 125_000 });
export async function historicalCall(root: string) {
  const deadline = Date.now() + 10_000;
  while (true) {
    const result = call(root, 'trace', 'gaps');
    if (result.status === 0 || Date.now() >= deadline) return result;
    assert.equal(JSON.parse(result.stderr).error, 'HawdbBusy', result.stderr);
    await Effect.runPromise(Effect.sleep('100 millis').pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  }
}


/** Only processes naming this isolated consumer are owned by this test. */
export async function waitForRefreshExit(root: string): Promise<void> {
  const failures: unknown[] = [];
  try { stopWorkspaceServer(root); } catch (cause) { failures.push(cause); }
  try {
    const active = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
      .filter(line => line.includes(root) && /query-(refresh|scan)-worker\.(?:js|ts)/u.test(line)).map(line => Number(line.trim().split(/\s/u)[0]));
    const deadline = Date.now() + 125_000;
    while (active().length && Date.now() < deadline) await Effect.runPromise(Effect.sleep('100 millis').pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
    for (const pid of active()) {
      try { process.kill(pid, 'SIGTERM'); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(cause); }
    }
    const cleanupDeadline = Date.now() + 5_000;
    while (active().length && Date.now() < cleanupDeadline) await Effect.runPromise(Effect.sleep('100 millis').pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
    assert.deepEqual(active(), [], 'Owned refresh processes must exit before deleting their consumer');
  } catch (cause) { failures.push(cause); }
  if (failures.length) throw new AggregateError(failures, `Diagnostic refresh cleanup unconfirmed for ${root}`);
}

export let packageScratch = '', installedCli = '';
before(() => Effect.runPromise(Effect.sync(() => {
  packageScratch = mkdtempSync(join(tmpdir(), 'concord-drift-installed-'));

  installedCli = sourceCli();
}).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime))));
after(() => Effect.runPromise(Effect.sync(() => { if (packageScratch) rmSync(packageScratch, { recursive: true, force: true }); }).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime))));
export const installedCall = (root: string, ...args: string[]) => spawnSync(process.execPath, [installedCli, '--root', root, ...args], { encoding: 'utf8', timeout: 30_000 });
export function packedConsumer(workload = true): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-drift-consumer-'));
  execFileSync('git', ['init', '-q', root]);
  const initialized = installedCall(root, '--json', 'init', '--test-root', 'test', '--source-root', 'src');
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(installedCall(root, '--json', 'new', 'feature', 'sample', '--title', 'Sample').status, 0);
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src/000.ts'), '// @concord-file\n// @concord-implements docs/feature/sample/README.md\nexport const first = 1;\n');
  writeFileSync(join(root, 'test/000.ts'), '// @feature docs/feature/sample/README.md\nexport const first = 1;\n');
  if (workload) for (let i = 1; i <= 250; i++) {
    writeFileSync(join(root, `src/${String(i).padStart(3, '0')}.ts`), `export const value${i} = ${i};\n`);
    writeFileSync(join(root, `test/${String(i).padStart(3, '0')}.ts`), `// @feature docs/feature/sample/README.md\nexport const test${i} = ${i};\n`);
  }
  return root;
}
export async function packedEnvelope(root: string, query: readonly string[]): Promise<ReturnType<typeof readQuery>> {
  const path = cacheDatabasePath(genericPrivateDirectorySync(root, process.env));
  if (!existsSync(path)) return {};
  let db;
  try {
    let entries;
    if (existsSync(recordPath(root))) {
      const current = record(root);
      const snapshot = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const connection = yield* connectWorkspaceSocket(current.socket.path, current.installation, current.token);
        return yield* requestWorkspace(connection, 'cache-snapshot', {});
      })).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
      entries = Schema.decodeUnknownSync(Snapshot, { onExcessProperty: 'error' })(snapshot).query_cache ?? [];
    } else {
      db = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
      entries = db.scan('query_cache');
    }
    const rows = entries.filter(row => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ format: Schema.optional(Schema.String) })), { onExcessProperty: 'ignore' })(row.payload).format === 'concord.query-cache/v3').map(row => Schema.decodeUnknownSync(Schema.fromJsonString(QueryCacheEnvelope), { onExcessProperty: 'error' })(row.payload));
    const operation = query[0] === 'review' ? undefined : query[1] === 'show' ? 'trace-show' : 'trace-gaps';
    return rows.find(row => row.record && (operation === undefined ? 'segments' in row.record.value : 'operation' in row.record.value && row.record.value.operation === operation && (operation !== 'trace-show' || 'subject' in row.record.value && row.record.value.subject.path === query[2])))
      ?? (rows.length === 1 ? rows[0]! : {});
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'HawdbBusy') return {};
    throw cause;
  } finally { db?.close(); }
}
export async function refreshInstalled(root: string, query: readonly string[]) {
  const requestedAt = Date.now();
  const requested = installedCall(root, '--json', ...query);
  assert.equal(requested.status, 0, JSON.stringify({ status: requested.status, signal: requested.signal, error: requested.error?.message, stdout: requested.stdout, stderr: requested.stderr }));
  await pollUntil(async () => {
    const value = await packedEnvelope(root, query);
    if ((value.error?.scannedAt ?? 0) >= requestedAt) assert.fail(JSON.stringify(value));
    return Math.max(value.record?.scannedAt ?? 0, value.lastAttempt?.scannedAt ?? 0) >= requestedAt ? true : undefined;
  }, { timeoutMs: 125_000, description: 'installed CLI diagnostic refresh' });
  return requested;
}
export async function editing(root: string, relative: string) {
  // Keep inode and size stable so C1/C2 exercise decoded-content drift. Opening
  // an atomically replaced file can correctly abort before a candidate exists.
  const child = spawn(process.execPath, [resolve('test/fixtures/projection-drift-writer.ts'), join(root, relative)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += String(bytes); });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  await Promise.race([
    new Promise<void>(resolveReady => { child.stdout.once('data', () => resolveReady()); }),
    completed.then(result => { throw new Error(`Writer exited before ready: ${JSON.stringify(result)}; ${stderr}`); }),
  ]);
  return async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const result = await completed;
    assert.ok(result.code === 0 || result.code === 130 || result.signal === 'SIGTERM', `Writer cleanup failed: ${JSON.stringify(result)}; ${stderr}`);
  };
}

export { makeOwnedProcessService };
export { installationResources };
export { installationRootForBin };
export { classifyQueryRefresh };
export { persist };
export { pathToFileURL };
export { sourceCli };
export { createConsumer };
export { genericPrivateDirectorySync };
export { refreshQuery };
export { pollUntil };
export { decodeDocumentSource };
export { workerEntryArgv };
export { installedConcordCli };
export { assert };
export { execFileSync };
export { spawn };
export { spawnSync };
export { existsSync };
export { mkdirSync };
export { mkdtempSync };
export { readFileSync };
export { rmSync };
export { symlinkSync };
export { writeFileSync };
export { tmpdir };
export { join };
export { resolve };
export { test };
export { before };
export { after };
export { Effect };
export { Schema };
export { sourceRoot };
export { prepareSourceConsumer };
export { cacheDatabasePath };
export { openHawdb };
export { readProjectConfig };
export { writeProjectConfig };
export { LocalRepository };
export { initialize };
export { setAuthor };
export { createDocument };
export { renderDocument };
export { ConcordError };
export { digest };
export { QueryCacheEnvelope };
export const queryContext = async (...args: Parameters<typeof identifyQuery>) => Effect.runPromise(identifyQuery(...args).pipe(Effect.provide(Workspace.layer), Effect.provide(NodeServices.layer)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));

export { readQuery };
export { storeQuery };
export type { Query };
