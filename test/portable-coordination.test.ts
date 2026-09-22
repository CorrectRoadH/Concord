import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, recoverPublicationLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from '../dist/coordination.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { beginRun, finalizeRun } from '../dist/run-coordination.js';
import { runCase } from '../dist/evidence.js';
import { OwnedProcessLive } from '../dist/owned-process.js';
import { buildTrace, requireValidTrace } from '../dist/trace.js';
import { createDocument } from '../dist/documents.js';

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
test('repository construction releases ownership; snapshots and commits use one short lease', t => {
  const root = fixture(t);
  const a = new LocalRepository(root), b = new LocalRepository(root);
  try {
    a.snapshot(() => assert.throws(() => b.snapshot(() => b.read('concord.config.ts')), { code: 'RepositoryBusy' }));
    b.snapshot(() => assert.ok(b.read('concord.config.ts')));
    a.publish('independent', [{ path: 'memory/one.md', before: null, after: 'one' }]);
    b.publish('independent', [{ path: 'memory/two.md', before: null, after: 'two' }]);
    assert.deepEqual(readdirSync(tracePrivateDirectorySync(root)), []);
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
