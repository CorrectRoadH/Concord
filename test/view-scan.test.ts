import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ViewScanManager } from '../dist/view-scan.js';
import { acquireTraceLeaseSync, releaseTraceLeaseSync } from '../dist/coordination.js';
import { initialize, LocalRepository } from '../dist/storage.js';

const Owner = Schema.Struct({ pid: Schema.Int, token: Schema.String });
async function scanPid(root: string): Promise<number> {
  const path = join(root, '.git/concord/trace/publication.lease');
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    try {
      for (const name of readdirSync(path)) {
        const owner = Schema.decodeUnknownSync(Schema.fromJsonString(Owner))(readFileSync(join(path, name), 'utf8'));
        if (owner.pid !== process.pid) return owner.pid;
      }
    } catch { /* snapshots acquire and release while the observer polls */ }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('Scan process did not acquire a snapshot');
}
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-scan-lifecycle-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: ['src'] }); } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < 1072; i++) writeFileSync(join(root, 'src', `${i}.ts`), `export const v${i} = ${i};\n`);
  return root;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name scan-child-termination-releases-exact-token
test('last scan waiter cancellation kills a stopped child and releases only its owned token', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture();
  const other = acquireTraceLeaseSync(root, 'shared', 'unrelated-reader')!;
  const manager = new ViewScanManager(root);
  const first = new AbortController(), second = new AbortController();
  const a = manager.scan(first.signal).catch(error => error);
  const b = manager.scan(second.signal).catch(error => error);
  let childPid: number | undefined;
  try {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline && childPid === undefined) {
      for (const name of readdirSync(other.path)) {
        try {
          const owner = Schema.decodeUnknownSync(Schema.fromJsonString(Owner))(readFileSync(join(other.path, name), 'utf8'));
          if (owner.pid !== process.pid) childPid = owner.pid;
        } catch { /* a short snapshot may already have released its token */ }
      }
      if (childPid === undefined) await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.ok(childPid, 'worker acquired its own shared lease');
    process.kill(childPid, 'SIGSTOP');
    first.abort();
    await a;
    assert.doesNotThrow(() => process.kill(childPid!, 0), 'one remaining waiter keeps the scan alive');
    second.abort();
    await b;
    await manager.close();
    assert.throws(() => process.kill(childPid!, 0), { code: 'ESRCH' });
    assert.deepEqual(readdirSync(other.path), [`${other.owner.token}.json`]);
    const next = new ViewScanManager(root);
    try { assert.equal((await next.scan()).kind, 'success'); } finally { await next.close(); }
    assert.ok(existsSync(join(other.path, `${other.owner.token}.json`)));
  } finally {
    if (childPid !== undefined) try { process.kill(childPid, 'SIGCONT'); } catch { /* already reaped */ }
    await manager.close();
    releaseTraceLeaseSync(other, 'unrelated-reader');
    rmSync(root, { recursive: true, force: true });
  }
})));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name scan-generations-do-not-reuse-completed-results
test('scan requests admitted together share a result and a later request observes changed source bytes', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture();
  const manager = new ViewScanManager(root);
  try {
    const firstRequest = manager.scan(), joinedRequest = manager.scan();
    const pid = await scanPid(root);
    process.kill(pid, 'SIGSTOP');
    const queuedRequest = manager.scan();
    process.kill(pid, 'SIGCONT');
    const [first, joined, queued] = await Promise.all([firstRequest, joinedRequest, queuedRequest]);
    assert.equal(first, joined);
    assert.notEqual(first, queued, 'arrivals during a scan wait for a distinct generation');
    writeFileSync(join(root, 'src/0.ts'), '// @concord-file\n// @concord-implements docs/constitution.md\nexport const changed = true;\n');
    const nextRequest = manager.scan();
    assert.equal(await scanPid(root), pid, 'successful generations reuse the idle scan process');
    const next = await nextRequest;
    assert.notEqual(next.body, first.body);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
})));
