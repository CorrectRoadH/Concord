// 跨进程保证：OS 锁与互斥——真实reader在link后被杀时恢复不侵占活writer，跨阶段新owner死亡仍需显式再恢复。
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
// @name recover-interrupted-reader-admission
test('recover reclaims a real reader killed after linking beside a dead writer', async t => {
  const root = fixture(t);
  const original = acquireTraceLeaseSync(root, 'shared', 'original')!;
  // A source consumer pauses only at the filesystem boundary;
  // production lease code creates and validates every owner record.
  const reader = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { acquireTraceLeaseSync } from './src/base/publication/index.ts';
    const link = fs.linkSync;
    fs.linkSync = (source, target) => {
      console.log('before-link');
      fs.readSync(0, Buffer.alloc(1), 0, 1, null);
      link(source, target);
      console.log('after-link');
      fs.readSync(0, Buffer.alloc(1), 0, 1, null);
    };
    syncBuiltinESMExports();
    acquireTraceLeaseSync(process.argv[1], 'shared', 'interrupted-reader');
  `, root], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] });
  let writer: ChildProcess | undefined;
  try {
    assert.equal(await line(reader), 'before-link');
    releaseTraceLeaseSync(original, 'original-exit');
    writer = holder(root);
    assert.equal(await line(writer), 'held');
    const linked = line(reader);
    reader.stdin!.write('1');
    assert.equal(await linked, 'after-link');
    const tokens = readdirSync(original.path).map(name => name.slice(0, -5)).sort();
    assert.equal(tokens.length, 2);
    await stop(reader);
    assert.throws(() => recoverPublicationLeaseSync(root), /busy/);
    assert.deepEqual(readdirSync(original.path).map(name => name.slice(0, -5)).sort(), tokens);
    await stop(writer);
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'recover'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
      status: Schema.Literal('clean'), journalStatus: Schema.Literal('clean'),
      coordination: Schema.Struct({ publication: Schema.Struct({ reclaimedTokens: Schema.Array(Schema.String) }), runner: Schema.Struct({ status: Schema.Literal('absent') }) }),
    })))(result.stdout);
    assert.deepEqual([...report.coordination.publication.reclaimedTokens].sort(), tokens);
    const next = acquireTraceLeaseSync(root, 'exclusive', 'next-writer')!;
    try { assert.throws(() => recoverPublicationLeaseSync(root), /busy/); }
    finally { releaseTraceLeaseSync(next, 'next-writer'); }
  } finally {
    await stop(reader);
    if (writer !== undefined) await stop(writer);
    releaseTraceLeaseSync(original, 'original-finally');
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name cli-shared-operation-access
test('ordinary CLI queries share ownership with a live reader', t => runApplication(Effect.sync(() => {
  const root = fixture(t);
  const setup = new LocalRepository(root);
  try { setup.snapshot(() => createDocument(setup, 'feature', { id: 'target', title: 'Target' })); }
  finally { setup.close(); }
  const reader = acquireTraceLeaseSync(root, 'shared', 'query-observer')!;
  try {
    for (const args of [
      ['list', 'memory'], ['list', 'memory'], ['memory', 'search', 'missing'],
      ['code', 'marker', '--scope', 'file', '--contract', 'docs/feature/target/README.md'],
      ['test', 'marker', '--contract', 'docs/feature/target/README.md'],
    ]) {
      const result = spawnSync(process.execPath, [entry, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    }
    assert.ok(existsSync(join(reader.path, `${reader.owner.token}.json`)), 'queries must not remove another live reader');
    assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'blocked-writer'), /busy/);
  } finally { releaseTraceLeaseSync(reader, 'query-observer'); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery final verification reports a competing publication owner', async t => {
  const root = fixture(t);
  const close = RepositoryBase.prototype.close;
  let concurrent: ReturnType<typeof acquireTraceLeaseSync>;
  let closes = 0;
  RepositoryBase.prototype.close = function() {
    close.call(this);
    if (++closes === 2) concurrent = acquireTraceLeaseSync(root, 'exclusive', 'between-recovery-and-verification');
  };
  try {
    await assert.rejects(runApplication(recoverLocalState(root)), { code: 'RepositoryBusy' });
    assert.ok(concurrent);
    assert.ok(existsSync(join(concurrent.path, `${concurrent.owner.token}.json`)));
  } finally {
    RepositoryBase.prototype.close = close;
    if (concurrent !== undefined) releaseTraceLeaseSync(concurrent, 'test-cleanup');
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery preserves a new dead owner between dispatch and either recovery engine', async t => {
  for (const trace of [false, true]) {
    const root = fixture(t);
    if (trace) {
      execFileSync('git', ['-C', root, 'add', 'concord.config.ts']);
      execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
      await assert.rejects(runApplication(mutateTraceFiles({ root, operation: 'stage-barrier', changes: [{ path: 'interrupted.md', bytes: 'planned\n' }], injectFailureAfterRename: 1 })), /injected interruption/);
    }
    const publicationPath = join(tracePrivateDirectorySync(root), 'publication.lease');
    const original = fs.rmdirSync;
    let token = '';
    fs.rmdirSync = (path, options) => {
      original(path, options);
      if (path === publicationPath && token === '') {
        token = 'starting';
        // The dispatcher has released its owner. A real process acquires the
        // resource and exits without releasing before the selected engine runs.
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
          import { acquireTraceLeaseSync } from './src/base/publication/index.ts';
          console.log(acquireTraceLeaseSync(process.argv[1], 'exclusive', 'interstage-owner').owner.token);
        `, root], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
        assert.equal(child.status, 0, child.stderr);
        token = child.stdout.trim();
      }
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(runApplication(recoverLocalState(root)), { code: 'RepositoryBusy' });
      assert.ok(existsSync(join(publicationPath, `${token}.json`)), 'the selected engine must not perform an unreported second reclamation');
      if (trace) assert.ok(existsSync(join(tracePrivateDirectorySync(root), 'multi-file-publication-journal.json')));
    } finally { fs.rmdirSync = original; syncBuiltinESMExports(); }
    const retried = await runApplication(recoverLocalState(root));
    assert.deepEqual(retried.coordination.publication.reclaimedTokens, [token]);
    assert.equal(retried.status, trace ? 'trace-recovered' : 'clean');
  }
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('built CLI initializes and publishes with only Node and Git on PATH', t => {
  const root = mkdtempSync(join(tmpdir(), 'concord-no-helper-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), consumer = join(root, 'consumer');
  mkdirSync(bin); mkdirSync(consumer);
  const git = (process.env.PATH ?? '').split(':').map(path => join(path, 'git')).find(path => existsSync(path));
  assert.ok(git);
  symlinkSync(git, join(bin, 'git')); symlinkSync(process.execPath, join(bin, 'node'));
  const env = { ...process.env, PATH: bin };
  execFileSync(git, ['init', '-q', consumer], { env });
  for (const args of [['init', '--docs-only'], ['new', 'feature', 'portable', '--title', 'Portable'], ['check']]) {
    execFileSync(process.execPath, [entry, '--root', consumer, ...args], { env });
  }
  assert.ok(existsSync(join(consumer, 'docs/feature/portable/README.md')));
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a live but quarantined runner blocks publication without reclaiming its ownership', t => {
  const root = fixture(t), repo = new LocalRepository(root);
  try {
    const run = repo.snapshot(() => beginRun(root));
    repo.snapshot(() => finalizeRun(root, run, false));
    assert.throws(() => repo.publish('blocked', [{ path: 'memory/blocked.md', before: null, after: 'no' }]), { code: 'CleanupFailed' });
    assert.equal(existsSync(join(root, 'memory/blocked.md')), false);
    assert.ok(existsSync(run.lease.path));
  } finally { repo.close(); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('long command releases document ownership and cooperative A-B-A invalidates its receipt', async t => {
  const root = fixture(t);
  const setup = new LocalRepository(root);
  setup.snapshot(() => createDocument(setup, 'feature', { id: 'example', title: 'Example' })); setup.close();
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test/example.test.mjs'), `import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
// @feature docs/feature/example/README.md
test('wait for editor', async () => {
  writeFileSync('.git/concord/test-ready', 'ready');
  while (!existsSync('.git/concord/test-continue')) await setTimeout(10);
});\n`);
  // Change the fixture configuration before opening its execution snapshot.
  const config = join(root, 'concord.config.ts');
  writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], runner: { kind: 'command', argv: [process.execPath, '--test', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
  const repo = new LocalRepository(root);
  const trace = repo.snapshot(() => buildTrace(repo, 'off', { includeCode: false })); requireValidTrace(trace);
  const result = runApplication(runCase(repo, trace.annotations.cases[0]!, trace.documents).pipe(Effect.provide(OwnedProcessLive)));
  try {
    const deadline = Date.now() + 15000;
    while (!existsSync(join(root, '.git/concord/test-ready'))) {
      if (Date.now() > deadline) throw new Error('runner did not become ready');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const path = 'docs/feature/example/README.md';
    const original = readFileSync(join(root, path), 'utf8');
    const editor = new LocalRepository(root);
    try {
      editor.publish('edit', [{ path, before: original, after: `${original}\nTransient edit\n` }]);
      editor.publish('revert-edit', [{ path, before: `${original}\nTransient edit\n`, after: original }]);
    } finally { editor.close(); }
    writeFileSync(join(root, '.git/concord/test-continue'), 'continue');
    await assert.rejects(result, { code: 'FileChangedSinceRead' });
    assert.equal(existsSync(join(root, '.git/concord/runner.lease')), false);
    // A changed configuration can reject receipt validation, but cannot keep a
    // successfully cleaned-up process group locked forever.
    rmSync(join(root, '.git/concord/test-ready'));
    rmSync(join(root, '.git/concord/test-continue'));
    const changedConfigRun = runApplication(runCase(repo, trace.annotations.cases[0]!, trace.documents).pipe(Effect.provide(OwnedProcessLive)));
    const rejected = assert.rejects(changedConfigRun, { code: 'FileChangedSinceRead' });
    const configDeadline = Date.now() + 15000;
    try {
      while (!existsSync(join(root, '.git/concord/test-ready'))) {
        if (Date.now() > configDeadline) throw new Error('second runner did not become ready');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      writeFileSync(config, `${readFileSync(config, 'utf8')}\n// edited during execution\n`);
    } finally { writeFileSync(join(root, '.git/concord/test-continue'), 'continue'); }
    await rejected;
    assert.equal(existsSync(join(root, '.git/concord/runner.lease')), false);
  } finally {
    writeFileSync(join(root, '.git/concord/test-continue'), 'continue');
    await result.catch(() => undefined); repo.close();
  }
});
