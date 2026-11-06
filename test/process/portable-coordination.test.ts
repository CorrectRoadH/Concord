import { initialize, createDocument } from '../support/operations.ts';
import { LocalRepository as RepositoryBase } from '../../src/base/workspace/index.ts';
import { runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';
import { installedConcordCli } from '../support/support.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect, Schema } from 'effect';
import { acquireTraceLeaseSync, recoverPublicationLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from "../../src/base/publication/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { beginRun, finalizeRun } from "../../src/base/publication/index.ts";
import { runCase } from "../../src/domain/tests/index.ts";
import { OwnedProcessLive } from "../../src/base/process/index.ts";
import { buildTrace, requireValidTrace } from "../../src/domain/trace/index.ts";

import { type FileLease } from "../../src/base/publication/index.ts";
import { digest, failure } from "../../src/model/index.ts";
import { waitForPublication } from "../../src/base/publication/index.ts";
import { recoverLocalState } from "../../src/app/index.ts";
import { mutateTraceFiles } from "../../src/base/publication/index.ts";

const entry = installedConcordCli();
import { fixture } from '../support/publication-ownership-fixture.ts';

async function line(child: ChildProcess): Promise<string> {
  return await new Promise((accept, reject) => {
    let source = '';
    const onData = (data: Buffer) => { source += data.toString(); if (source.includes('\n')) { cleanup(); accept(source.trim()); } };
    const onExit = () => { cleanup(); reject(new Error(`child exited before readiness: ${source}`)); };
    const cleanup = () => { child.stdout!.off('data', onData); child.off('exit', onExit); child.off('error', reject); };
    child.stdout!.on('data', onData); child.once('exit', onExit); child.once('error', reject);
  });
}

function holder(root: string, recover = false): ChildProcess {
  // Real subprocess using the source coordination API.
  return spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireTraceLeaseSync, recoverPublicationLeaseSync, releaseTraceLeaseSync } from './src/base/publication/index.ts';
    try {
      if (process.argv[2] === 'recover') recoverPublicationLeaseSync(process.argv[1]);
      const lease = acquireTraceLeaseSync(process.argv[1], 'exclusive', 'consumer');
      console.log('held');
      process.stdin.once('data', () => { releaseTraceLeaseSync(lease, 'consumer'); process.exit(0); });
    } catch (error) { console.log('refused:' + error.message); process.exit(0); }
  `, root, recover ? 'recover' : 'hold'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name publication-wait-does-not-reclaim-later-deaths
test('acquisition waiting does not reclaim an owner that arrived after its first dead-owner recovery', async t => {
  const root = fixture(t);
  const dead = holder(root);
  assert.equal(await line(dead), 'held');
  await stop(dead);
  const path = join(tracePrivateDirectorySync(root), 'publication.lease');
  const original = fs.rmdirSync;
  let token = '';
  fs.rmdirSync = (target, options) => {
    original(target, options);
    if (target === path && token === '') {
      token = 'starting';
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { acquireTraceLeaseSync } from './src/base/publication/index.ts';
        console.log(acquireTraceLeaseSync(process.argv[1], 'exclusive', 'new-dead-owner').owner.token);
      `, root], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
      assert.equal(child.status, 0, child.stderr);
      token = child.stdout.trim();
    }
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(runApplication(waitForPublication(reclaimDead => Effect.try({
      try: () => new LocalRepository(root, { reclaimPublication: reclaimDead }), catch: failure,
    }))), { code: 'RepositoryBusy' });
    assert.ok(existsSync(join(path, `${token}.json`)));
  } finally { fs.rmdirSync = original; syncBuiltinESMExports(); }
  assert.deepEqual(recoverPublicationLeaseSync(root), [token]);
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name ordinary-query-reclaims-dead-publication
test('ordinary built CLI reads despite a killed publication owner and preserves its token', async t => {
  const root = fixture(t);
  const dead = holder(root);
  try {
    assert.equal(await line(dead), 'held');
    await stop(dead);
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'list', 'memory'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(join(tracePrivateDirectorySync(root), 'publication.lease')), true);
  } finally { await stop(dead); recoverPublicationLeaseSync(root); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name live-publication-wait-is-bounded
test('built CLI reads without waiting for live publication owners and preserves their tokens', async t => {
  const root = fixture(t);
  const live = holder(root);
  try {
    assert.equal(await line(live), 'held');
    const path = join(tracePrivateDirectorySync(root), 'publication.lease');
    const before = readdirSync(path);
    const started = performance.now();
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'list', 'memory'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(readdirSync(path), before);
  } finally { await stop(live); recoverPublicationLeaseSync(root); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name ordinary-query-waits-for-publication
test('built CLI succeeds when a contending writer finishes within the acquisition deadline', async t => {
  const root = fixture(t);
  const live = holder(root);
  try {
    assert.equal(await line(live), 'held');
    const query = spawn(process.execPath, [entry, '--root', root, '--json', 'list', 'memory'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    query.stdout.on('data', chunk => { output += String(chunk); });
    query.stderr.on('data', chunk => { output += String(chunk); });
    const finished = once(query, 'exit');
    const timer = setTimeout(() => live.stdin!.write('release'), 1200);
    try { assert.equal((await finished)[0], 0, output); }
    finally { clearTimeout(timer); await stop(query); }
  } finally { await stop(live); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('real owner death and competing recoverers never grant two live writers', async t => {
  const root = fixture(t);
  const dead = holder(root);
  assert.equal(await line(dead), 'held');
  assert.throws(() => new LocalRepository(root), { code: 'RepositoryBusy' });
  await stop(dead);
  const first = holder(root, true), second = holder(root, true);
  try {
    const results = await Promise.all([line(first), line(second)]);
    assert.equal(results.filter(value => value === 'held').length, 1, results.join('\n'));
    assert.throws(() => recoverPublicationLeaseSync(root), /busy/);
    assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'third'), /busy/);
  } finally { await Promise.all([stop(first), stop(second)]); }
  recoverPublicationLeaseSync(root);
  const next = acquireTraceLeaseSync(root, 'exclusive', 'after-recovery')!;
  releaseTraceLeaseSync(next, 'after-recovery');
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
