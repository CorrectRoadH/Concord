import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect, Schema } from 'effect';
import { acquireTraceLeaseSync, recoverPublicationLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from '../dist/coordination.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { beginRun, finalizeRun } from '../dist/run-coordination.js';
import { runCase } from '../dist/evidence.js';
import { OwnedProcessLive } from '../dist/owned-process.js';
import { buildTrace, requireValidTrace } from '../dist/trace.js';
import { createDocument } from '../dist/documents.js';
import type { FileLease } from '../dist/file-lease.js';
import { digest, failure } from '../dist/shared.js';
import { waitForPublication } from '../dist/publication-wait.js';
import { recoverLocalState } from '../dist/recovery.js';
import { mutateTraceFiles } from '../dist/repository/docs/trace/relation-mutation.js';

const entry = resolve('dist/entry.js');
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-portable-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { repo.snapshot(() => initialize(repo, false, { testRoots: [] })); } finally { repo.close(); }
  return root;
}

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
  // Explicit JavaScript consumer fixture of the built public coordination API.
  return spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireTraceLeaseSync, recoverPublicationLeaseSync, releaseTraceLeaseSync } from './dist/coordination.js';
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
        import { acquireTraceLeaseSync } from './dist/coordination.js';
        console.log(acquireTraceLeaseSync(process.argv[1], 'exclusive', 'new-dead-owner').owner.token);
      `, root], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
      assert.equal(child.status, 0, child.stderr);
      token = child.stdout.trim();
    }
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(Effect.runPromise(waitForPublication(reclaimDead => Effect.try({
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
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'memory', 'list'], { encoding: 'utf8', timeout: 15000 });
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
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'memory', 'list'], { encoding: 'utf8', timeout: 15000 });
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
    const query = spawn(process.execPath, [entry, '--root', root, '--json', 'memory', 'list'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
test('repository construction releases ownership; snapshots and commits use one short lease', t => {
  const root = fixture(t);
  const a = new LocalRepository(root), b = new LocalRepository(root);
  try {
    a.snapshot(() => assert.throws(() => b.snapshot(() => b.read('concord.config.ts')), { code: 'RepositoryBusy' }));
    b.snapshot(() => assert.ok(b.read('concord.config.ts')));
    a.publish('independent', [{ path: 'memory/one.md', before: null, after: 'one' }]);
    b.publish('independent', [{ path: 'memory/two.md', before: null, after: 'two' }]);
    assert.deepEqual(readdirSync(tracePrivateDirectorySync(root)), ['publication.revision']);
  } finally { a.close(); b.close(); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('publication rejects changed read dependencies, missing reads and directory membership', t => {
  const root = fixture(t);
  for (const kind of ['bytes', 'absent', 'directory']) {
    const dependency = join(root, `memory/${kind}-dependency.md`);
    if (kind === 'bytes') writeFileSync(dependency, 'before');
    const repo = new LocalRepository(root);
    try {
      repo.snapshot(() => kind === 'directory' ? repo.files('memory') : repo.read(`memory/${kind}-dependency.md`));
      writeFileSync(dependency, 'changed');
      assert.throws(() => repo.publish('stale', [{ path: `memory/${kind}-target.md`, before: null, after: 'must not appear' }]), { code: 'PreimageChanged' });
      assert.equal(existsSync(join(root, `memory/${kind}-target.md`)), false);
      assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
    } finally { repo.close(); }
  }
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
// @name recover-interrupted-reader-admission
test('recover reclaims a real reader killed after linking beside a dead writer', async t => {
  const root = fixture(t);
  const original = acquireTraceLeaseSync(root, 'shared', 'original')!;
  // A built-API JavaScript consumer pauses only at the filesystem boundary;
  // production lease code creates and validates every owner record.
  const reader = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { acquireTraceLeaseSync } from './dist/coordination.js';
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
test('ordinary CLI queries share ownership with a live reader', t => Effect.runPromise(Effect.sync(() => {
  const root = fixture(t);
  const setup = new LocalRepository(root);
  try { setup.snapshot(() => createDocument(setup, 'feature', { id: 'target', title: 'Target' })); }
  finally { setup.close(); }
  const reader = acquireTraceLeaseSync(root, 'shared', 'query-observer')!;
  try {
    for (const args of [
      ['memory', 'list'], ['memory', 'index'], ['memory', 'recall', 'missing'],
      ['code', 'annotate', '--scope', 'file', '--contract', 'docs/feature/target/README.md'],
      ['test', 'annotate', '--contract', 'docs/feature/target/README.md'],
    ]) {
      const result = spawnSync(process.execPath, [entry, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    }
    assert.ok(existsSync(join(reader.path, `${reader.owner.token}.json`)), 'queries must not remove another live reader');
    assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'blocked-writer'), /busy/);
  } finally { releaseTraceLeaseSync(reader, 'query-observer'); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name recovery-reports-runner-blocker
test('CLI recovery reports quarantined runner instead of claiming clean readiness', t => Effect.runPromise(Effect.sync(() => {
  const root = fixture(t);
  const repo = new LocalRepository(root);
  try {
    const run = repo.snapshot(() => beginRun(root));
    repo.snapshot(() => finalizeRun(root, run, false));
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'recover'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.String })))(result.stdout);
    assert.equal(report.status, 'blocked');
    assert.ok(existsSync(join(run.lease.path, `${run.lease.owner.token}.json`)));
    const observed = spawnSync(process.execPath, [entry, '--root', root, '--json', 'memory', 'list'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(observed.status, 0, observed.stderr);
    assert.throws(() => repo.publish('still-blocked', [{ path: 'memory/blocked.md', before: null, after: 'no' }]), { code: 'CleanupFailed' });
  } finally { repo.close(); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery preserves prepared and committed journals when runner cleanup is unknown', t => Effect.runPromise(Effect.sync(() => {
  for (const phase of ['prepared', 'committed']) {
    const root = fixture(t);
    const repo = new LocalRepository(root);
    try {
      const run = repo.snapshot(() => beginRun(root));
      repo.snapshot(() => finalizeRun(root, run, false));
      const config = repo.configSnapshot;
      const journal = JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), projectId: config.config.projectId,
        operation: 'interrupted', phase, directories: [],
        scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: config.source, configDigest: config.digest },
        changes: [{ path: 'memory/interrupted.md', before: null, after: 'pending\n', beforeDigest: null, afterDigest: digest('pending\n'), mode: 420 }],
      });
      const path = join(root, '.git/concord/journal.json');
      writeFileSync(join(root, 'memory/interrupted.md'), 'pending\n');
      writeFileSync(path, journal);
      for (const args of [['recover'], ['action', '--input', '-']]) {
        const result = spawnSync(process.execPath, [entry, '--root', root, '--json', ...args], { input: JSON.stringify({ action: 'recover' }), encoding: 'utf8', timeout: 15000 });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('blocked'), journalStatus: Schema.Literal('pending') })))(result.stdout);
        assert.equal(report.status, 'blocked');
        assert.equal(readFileSync(path, 'utf8'), journal);
        assert.equal(readFileSync(join(root, 'memory/interrupted.md'), 'utf8'), 'pending\n');
      }
    } finally { repo.close(); }
  }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery final verification reports a competing publication owner', async t => {
  const root = fixture(t);
  const close = LocalRepository.prototype.close;
  let concurrent: ReturnType<typeof acquireTraceLeaseSync>;
  let closes = 0;
  LocalRepository.prototype.close = function() {
    close.call(this);
    if (++closes === 2) concurrent = acquireTraceLeaseSync(root, 'exclusive', 'between-recovery-and-verification');
  };
  try {
    await assert.rejects(Effect.runPromise(recoverLocalState(root)), { code: 'RepositoryBusy' });
    assert.ok(concurrent);
    assert.ok(existsSync(join(concurrent.path, `${concurrent.owner.token}.json`)));
  } finally {
    LocalRepository.prototype.close = close;
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
      await assert.rejects(Effect.runPromise(mutateTraceFiles({ root, operation: 'stage-barrier', changes: [{ path: 'interrupted.md', bytes: 'planned\n' }], injectFailureAfterRename: 1 })), /injected interruption/);
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
          import { acquireTraceLeaseSync } from './dist/coordination.js';
          console.log(acquireTraceLeaseSync(process.argv[1], 'exclusive', 'interstage-owner').owner.token);
        `, root], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
        assert.equal(child.status, 0, child.stderr);
        token = child.stdout.trim();
      }
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(Effect.runPromise(recoverLocalState(root)), { code: 'RepositoryBusy' });
      assert.ok(existsSync(join(publicationPath, `${token}.json`)), 'the selected engine must not perform an unreported second reclamation');
      if (trace) assert.ok(existsSync(join(tracePrivateDirectorySync(root), 'multi-file-publication-journal.json')));
    } finally { fs.rmdirSync = original; syncBuiltinESMExports(); }
    const retried = await Effect.runPromise(recoverLocalState(root));
    assert.deepEqual(retried.coordination.publication.reclaimedTokens, [token]);
    assert.equal(retried.status, trace ? 'trace-recovered' : 'clean');
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('unknown lock state and repeated old close preserve a new owner', t => {
  const root = fixture(t);
  const first = acquireTraceLeaseSync(root, 'exclusive', 'first')!;
  releaseTraceLeaseSync(first, 'first');
  const second = acquireTraceLeaseSync(root, 'exclusive', 'second')!;
  releaseTraceLeaseSync(first, 'late-close');
  assert.ok(existsSync(join(second.path, `${second.owner.token}.json`)));
  writeFileSync(join(second.path, 'unknown'), 'preserve');
  assert.throws(() => recoverPublicationLeaseSync(root), /unexpected files/);
  assert.throws(() => releaseTraceLeaseSync(second, 'unknown'), /unexpected files/);
  assert.equal(readFileSync(join(second.path, 'unknown'), 'utf8'), 'preserve');
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name shared-join-directory-replacement
test('reader admission rechecks a replaced directory and writer release tolerates pending readers', t => Effect.runPromise(Effect.sync(() => {
  const root = fixture(t);
  for (const writerExitsBeforeValidation of [false, true]) {
    const first = acquireTraceLeaseSync(root, 'shared', 'first-reader')!;
    let writer: FileLease | undefined, joined: FileLease | undefined;
    const originalLink = fs.linkSync;
    let injected = false;
    // Only the filesystem scheduling boundary is intercepted. All ownership
    // transitions and protected checks execute the production implementation.
    fs.linkSync = (source, destination) => {
      if (!injected) {
        injected = true;
        releaseTraceLeaseSync(first, 'last-reader-exits');
        writer = acquireTraceLeaseSync(root, 'exclusive', 'replacement-writer')!;
        originalLink(source, destination);
        if (writerExitsBeforeValidation) releaseTraceLeaseSync(writer, 'writer-exits');
      } else originalLink(source, destination);
    };
    syncBuiltinESMExports();
    try {
      if (writerExitsBeforeValidation) {
        joined = acquireTraceLeaseSync(root, 'shared', 'joining-reader')!;
        assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'third-writer'), /busy/);
      } else {
        assert.throws(() => acquireTraceLeaseSync(root, 'shared', 'joining-reader'), /busy/);
        assert.ok(writer);
        assert.deepEqual(readdirSync(writer.path), [`${writer.owner.token}.json`]);
      }
      assert.equal(injected, true);
    } finally {
      fs.linkSync = originalLink; syncBuiltinESMExports();
      if (joined) releaseTraceLeaseSync(joined, 'reader-done');
      if (writer) releaseTraceLeaseSync(writer, 'writer-done');
      releaseTraceLeaseSync(first, 'first-done');
    }
    assert.equal(existsSync(first.path), false);
  }
})));

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
  for (const args of [['init', '--docs-only'], ['feature', 'create', 'portable', '--title', 'Portable'], ['check']]) {
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
  writeFileSync(config, readFileSync(config, 'utf8').replace('"testRoots": []', '"testRoots": ["test"]'));
  const repo = new LocalRepository(root);
  const trace = repo.snapshot(() => buildTrace(repo, 'off', { includeCode: false })); requireValidTrace(trace);
  const result = Effect.runPromise(runCase(repo, trace.annotations.cases[0]!, trace.documents).pipe(Effect.provide(OwnedProcessLive)));
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
    const evidence = await result;
    assert.equal(evidence.commandOutcome, 'invalid');
    assert.equal(evidence.cleanupOk, true);
    assert.equal(existsSync(join(root, '.git/concord/runner.lease')), false);
    // A changed configuration can reject receipt validation, but cannot keep a
    // successfully cleaned-up process group locked forever.
    rmSync(join(root, '.git/concord/test-ready'));
    rmSync(join(root, '.git/concord/test-continue'));
    const changedConfigRun = Effect.runPromise(runCase(repo, trace.annotations.cases[0]!, trace.documents).pipe(Effect.provide(OwnedProcessLive)));
    const rejected = assert.rejects(changedConfigRun, /configuration changed/);
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
