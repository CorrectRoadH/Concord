import { makeOwnedProcessService } from '../../src/base/process/index.js';
import { installationResources, installationRootForBin } from '../../src/base/installation/index.js';
import { classifyQueryRefresh, persist } from '../../src/app/index.js';
import { pathToFileURL } from 'node:url';
import { packageBin } from '../../scripts/package-location.js';
import { createConsumer } from './consumer.js';
import { genericPrivateDirectorySync } from "../../src/base/publication/index.js";
import { refreshQuery } from "../../src/app/index.js";
import { pollUntil } from './support.js';
import { decodeDocumentSource } from "../../src/domain/documents/index.js";
import { workerEntryArgv } from "../../src/base/installation/index.js";
import { installedConcordCli } from './support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from './temporary.js';
import { join, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { packConcord, installConcord } from './installed-package.js';
import { cacheDatabasePath } from "../../src/base/cache/index.js";
import { openHawdb } from "../../src/base/cache/index.js";
import { readProjectConfig, writeProjectConfig } from './support.js';
import { LocalRepository } from "./repository.js";
import { initialize } from "../../src/app/index.js";
import { setAuthor } from "../../src/domain/documents/index.js";
import { createDocument } from "../../src/app/index.js";
import { renderDocument } from "../../src/model/index.js";
import { ConcordError, digest } from "../../src/model/index.js";
import { QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query } from "../../src/app/index.js";

export const gaps = (marker = 'original') => ({ operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: [marker], contracts: [], cliPages: [], unmarkedLists: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } });
export const candidate = (marker = 'original', scannedAt = Date.now()) => ({ kind: 'candidate' as const, message: { format: 'concord.query-scan/v1' as const, ok: true as const, scannedAt, finishedAt: Date.now(), value: gaps(marker), complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } } });
export function consumer(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); } finally { repo.close(); }
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
    await Effect.runPromise(Effect.sleep('100 millis'));
  }
}


/** Only processes naming this isolated consumer are owned by this test. */
export async function waitForRefreshExit(root: string): Promise<void> {
  const active = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes(root) && /query-(refresh|scan)-worker\.(?:js|ts)/u.test(line)).map(line => Number(line.trim().split(/\s/u)[0]));
  const deadline = Date.now() + 125_000;
  while (active().length && Date.now() < deadline) await Effect.runPromise(Effect.sleep('100 millis'));
  for (const pid of active()) { try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  const cleanupDeadline = Date.now() + 5_000;
  while (active().length && Date.now() < cleanupDeadline) await Effect.runPromise(Effect.sleep('100 millis'));
  assert.deepEqual(active(), [], 'Owned refresh processes must exit before deleting their consumer');
}

export let packageScratch = '', installedCli = '';
before(() => Effect.runPromise(Effect.sync(() => {
  packageScratch = mkdtempSync(join(tmpdir(), 'concord-drift-installed-'));
  const packed = packConcord(packageScratch);
  const tool = join(packageScratch, 'tool'); mkdirSync(tool);
  writeFileSync(join(tool, 'package.json'), JSON.stringify({ private: true }));
  installConcord(tool, packed);
  installedCli = packageBin(join(tool, 'node_modules/concord-sdlc'));
})));
after(() => Effect.runPromise(Effect.sync(() => { if (packageScratch) rmSync(packageScratch, { recursive: true, force: true }); })));
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
export function packedEnvelope(root: string, query: readonly string[]): ReturnType<typeof readQuery> {
  const path = cacheDatabasePath(genericPrivateDirectorySync(root));
  if (!existsSync(path)) return {};
  let db;
  try {
    db = openHawdb(path, { readOnly: true, create: false });
    const rows = db.scan('query_cache').filter(row => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ format: Schema.optional(Schema.String) })), { onExcessProperty: 'ignore' })(row.payload).format === 'concord.query-cache/v3').map(row => Schema.decodeUnknownSync(Schema.fromJsonString(QueryCacheEnvelope), { onExcessProperty: 'error' })(row.payload));
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
  assert.ok(requested.status === 0 || requested.status === 1, requested.stderr);
  await pollUntil(async () => {
    const value = packedEnvelope(root, query);
    return Math.max(value.record?.scannedAt ?? 0, value.lastAttempt?.scannedAt ?? 0, value.error?.scannedAt ?? 0) >= requestedAt ? true : undefined;
  }, { timeoutMs: 125_000, description: 'installed CLI diagnostic refresh' });
  await waitForRefreshExit(root);
  return { status: 0, stderr: '' };
}
export async function editing(root: string, relative: string) {
  // Keep inode and size stable so C1/C2 exercise decoded-content drift. Opening
  // an atomically replaced file can correctly abort before a candidate exists.
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('test/fixtures/projection-drift-writer.ts'), join(root, relative)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolveReady, reject) => { child.stdout.once('data', () => resolveReady()); child.once('error', reject); child.once('exit', code => reject(new Error(`Writer exited before ready: ${code}`))); });
  return async () => { const exited = new Promise<void>(resolveExit => child.once('close', () => resolveExit())); child.kill('SIGTERM'); await exited; };
}

export { makeOwnedProcessService };
export { installationResources };
export { installationRootForBin };
export { classifyQueryRefresh };
export { persist };
export { pathToFileURL };
export { packageBin };
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
export { packConcord };
export { installConcord };
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
export { queryContext };
export { readQuery };
export { storeQuery };
export type { Query };
