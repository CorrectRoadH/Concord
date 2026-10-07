import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs, { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect } from 'effect';
import { readProjectConfig, writeProjectConfig } from './support.js';
import { LocalRepository, initialize, readRepositoryFileSync } from '../dist/storage.js';

function fixture(t: TestContext): { container: string; parent: string; root: string } {
  const container = realpathSync(mkdtempSync(join(tmpdir(), 'concord-path-cost-')));
  const parent = join(container, 'parent');
  const root = join(parent, 'repo');
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.ts'), 'a');
  writeFileSync(join(root, 'src/b.ts'), 'b');
  t.after(() => rmSync(container, { recursive: true, force: true }));
  return { container, parent, root };
}

function reader(t: TestContext, root: string): LocalRepository {
  const repo = new LocalRepository(root, { access: 'read' });
  t.after(() => repo.close());
  return repo;
}

function insensitiveDarwin(t: TestContext, root: string): boolean {
  if (process.platform !== 'darwin') { t.skip('Darwin spelling case requires macOS'); return false; }
  const probe = join(root, 'CaseProbe');
  writeFileSync(probe, 'probe');
  const insensitive = existsSync(join(root, 'caseprobe'));
  rmSync(probe);
  if (!insensitive) t.skip('The real temporary-directory volume is case-sensitive');
  return insensitive;
}

function onOpen<A>(target: string, mutate: () => void, read: () => A): A {
  const original = fs.openSync;
  let fired = false;
  fs.openSync = ((path, ...args) => {
    if (!fired && path === target) { fired = true; mutate(); }
    return Reflect.apply(original, fs, [path, ...args]);
  }) as typeof fs.openSync;
  syncBuiltinESMExports();
  try { return read(); } finally { fs.openSync = original; syncBuiltinESMExports(); assert.equal(fired, true); }
}

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('source discovery excludes environment entries before path checks and keeps strict observations independent', t => Effect.runSync(Effect.sync(() => {
  const { container, root } = fixture(t);
  const outside = join(container, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.ts'), '// @feature docs/feature/absent/README.md');
  symlinkSync(outside, join(root, 'src/.env'));
  symlinkSync(join(container, 'absent'), join(root, 'src/.env.local'));
  writeFileSync(join(root, 'src/.env.production'), 'secret');
  mkdirSync(join(root, 'src/.env.example'));
  symlinkSync(outside, join(root, 'src/.env.example/link'));
  writeFileSync(join(root, 'src/.environment.ts'), 'valid source');
  mkdirSync(join(root, 'src/dist'));
  writeFileSync(join(root, 'src/dist/generated.ts'), 'generated source');
  const repo = reader(t, root);
  const expected = ['src/.environment.ts', 'src/a.ts', 'src/b.ts'];
  assert.deepEqual(repo.files('src/dist', 'source'), ['src/dist/generated.ts']);
  repo.snapshot(() => {
    assert.deepEqual(repo.files('src', 'source'), expected);
    rmSync(join(root, 'src/.env'));
    writeFileSync(join(root, 'src/.env'), 'changed excluded type');
    writeFileSync(join(root, 'src/.env.production'), 'changed excluded bytes');
    symlinkSync(outside, join(root, 'src/.env.new'));
  });
  assert.throws(() => repo.files('src'), { code: 'UnsafePath' });
  assert.throws(() => repo.read('src/.env.local'), { code: 'UnsafePath' });
  assert.throws(() => repo.files('src/.env.local', 'source'), { code: 'UnsafePath' });
  assert.throws(() => repo.snapshot(() => {
    repo.files('src', 'source');
    symlinkSync(outside, join(root, 'src/linked.ts'));
  }), { code: 'UnsafePath' });
  rmSync(join(root, 'src/linked.ts'));
  assert.throws(() => repo.snapshot(() => {
    repo.files('src', 'source');
    writeFileSync(join(root, 'src/new.ts'), 'new source');
  }), { code: 'PreimageChanged' });

  mkdirSync(join(root, 'mixed'));
  writeFileSync(join(root, 'mixed/.env'), 'before');
  for (const scopes of [[undefined, 'source'], ['source', undefined]] as const) {
    assert.throws(() => repo.snapshot(() => {
      for (const scope of scopes) repo.files('mixed', scope);
      fs.appendFileSync(join(root, 'mixed/.env'), 'after');
    }), { code: 'PreimageChanged' });
  }
})));

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('configured discovery exclusions preserve explicit reads, root overrides and snapshot scope', t => Effect.runSync(Effect.sync(() => {
  const { root, container } = fixture(t);
  const config = readProjectConfig(root);
  for (const path of ['', '/src', '../src', 'src/../a', 'src//a', 'src/', 'src/*', 'src/!a', 'C:/src', 'src\\a']) {
    assert.throws(() => writeProjectConfig(root, { ...config, sourceIgnore: [path] }));
  }
  writeProjectConfig(root, { ...config, sourceIgnore: ['src/ignored', 'src/file.ts', 'src/generated'] });
  symlinkSync(join(container, 'absent'), join(root, 'src/ignored'));
  writeFileSync(join(root, 'src/file.ts'), 'excluded');
  mkdirSync(join(root, 'src/generated'));
  writeFileSync(join(root, 'src/generated/a.ts'), 'explicit root');
  writeFileSync(join(root, 'src/file.tsx'), 'prefix sibling');
  const repo = reader(t, root);
  repo.snapshot(() => {
    assert.deepEqual(repo.files('src', 'source'), ['src/a.ts', 'src/b.ts', 'src/file.tsx']);
    writeFileSync(join(root, 'src/file.ts'), 'changed ignored bytes');
    writeFileSync(join(root, 'src/generated/new.ts'), 'new ignored file');
  });
  assert.deepEqual(repo.files('src/generated', 'source'), ['src/generated/a.ts', 'src/generated/new.ts']);
  assert.equal(repo.read('src/file.ts'), 'changed ignored bytes');
  assert.throws(() => repo.read('src/ignored'), { code: 'UnsafePath' });
  assert.throws(() => repo.files('src'), { code: 'UnsafePath' });
  assert.throws(() => repo.snapshot(() => {
    repo.files('src', 'source');
    writeProjectConfig(root, config);
  }), { code: 'PreimageChanged' });
  const unfiltered = reader(t, root);
  assert.throws(() => unfiltered.files('src', 'source'), { code: 'UnsafePath' });
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('standalone repository reads reject symlinks and retain canonical and regular-file guards', t => Effect.runSync(Effect.sync(() => {
  const { container, root } = fixture(t);
  const outside = join(container, 'outside.md');
  writeFileSync(outside, 'outside');
  symlinkSync(outside, join(root, 'linked.md'));
  assert.throws(() => readRepositoryFileSync(root, 'linked.md'), { code: 'UnsafePath' });
  assert.throws(() => readRepositoryFileSync(root, '../outside.md'), { code: 'UnsafePath' });
  assert.throws(() => readRepositoryFileSync(root, outside), { code: 'UnsafePath' });
  assert.throws(() => readRepositoryFileSync(root, 'src'), { code: 'InvalidFile' });
  assert.equal(readRepositoryFileSync(root, 'missing.md'), undefined);
  assert.equal(readRepositoryFileSync(root, 'src/a.ts'), 'a');
  const oversized = join(root, 'oversized.md');
  writeFileSync(oversized, ''); truncateSync(oversized, 32 * 1024 * 1024 + 1);
  assert.throws(() => readRepositoryFileSync(root, 'oversized.md'), { code: 'InvalidFile' });
  const replacement = join(root, 'src/replacement.ts');
  writeFileSync(replacement, 'x');
  assert.throws(() => onOpen(join(root, 'src/b.ts'), () => renameSync(replacement, join(root, 'src/b.ts')), () => readRepositoryFileSync(root, 'src/b.ts')), { code: 'SourceChanged' });
  assert.throws(() => onOpen(join(root, 'src/a.ts'), () => { rmSync(join(root, 'src/a.ts')); symlinkSync(outside, join(root, 'src/a.ts')); }, () => readRepositoryFileSync(root, 'src/a.ts')), { code: 'UnsafePath' });
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('standalone repository reads reject Darwin spelling mismatches without cached listings', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  if (!insensitiveDarwin(t, root)) return;
  writeFileSync(join(root, 'docs/feature.md'), 'before');
  assert.throws(() => readRepositoryFileSync(root, 'docs/Feature.md'), { code: 'UnsafePath' });
  assert.equal(readRepositoryFileSync(root, 'docs/feature.md'), 'before');
  renameSync(join(root, 'docs/feature.md'), join(root, 'docs/Feature.md'));
  assert.throws(() => readRepositoryFileSync(root, 'docs/feature.md'), { code: 'UnsafePath' });
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C1/C1b: replaced ancestor symlink or real directory is refused before another read', t => Effect.runSync(Effect.sync(() => {
  const { container, parent, root } = fixture(t);
  const repo = reader(t, root);
  const backup = join(container, 'saved');
  for (const kind of ['symlink', 'directory']) {
    try {
      assert.throws(() => repo.snapshot(() => {
        assert.equal(repo.read('src/a.ts'), 'a');
        renameSync(parent, backup);
        if (kind === 'symlink') symlinkSync(backup, parent, 'dir');
        else { mkdirSync(join(parent, 'repo/src'), { recursive: true }); writeFileSync(join(parent, 'repo/src/b.ts'), 'outside'); }
        repo.read('src/b.ts');
      }), { code: 'UnsafePath' });
    } finally { rmSync(parent, { recursive: true, force: true }); renameSync(backup, parent); }
  }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C2/C2b: internal directory and open-time leaf symlinks are refused', t => Effect.runSync(Effect.sync(() => {
  const { container, root } = fixture(t);
  const repo = reader(t, root);
  const src = join(root, 'src');
  const saved = join(root, 'saved');
  try {
    assert.throws(() => repo.snapshot(() => {
      repo.read('src/a.ts'); renameSync(src, saved); symlinkSync(saved, src, 'dir'); repo.read('src/b.ts');
    }), { code: 'UnsafePath' });
  } finally { rmSync(src); renameSync(saved, src); }
  const secret = join(container, 'secret');
  writeFileSync(secret, 'outside');
  const target = join(src, 'a.ts');
  assert.throws(() => onOpen(target, () => { rmSync(target); symlinkSync(secret, target); }, () => repo.snapshot(() => repo.read('src/a.ts'))), { code: 'UnsafePath' });
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C3/C3b: Darwin case rename rejects current reads and publication and reports the exact drift path', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  if (!insensitiveDarwin(t, root)) return;
  const upper = join(root, 'docs/Feature.md');
  const lower = join(root, 'docs/feature.md');
  writeFileSync(upper, 'original');
  const repo = reader(t, root);
  assert.throws(() => repo.snapshot(() => { repo.read('docs/Feature.md'); renameSync(upper, lower); assert.equal(repo.read('docs/Feature.md'), 'original'); }), { code: 'PreimageChanged', details: 'source-observation' });
  renameSync(lower, upper);
  const projection = repo.observeProjection(() => { repo.read('docs/Feature.md'); renameSync(upper, lower); return 'value'; });
  assert.deepEqual(projection.drift.files, ['docs/Feature.md']);
  assert.deepEqual(projection.drift.directories, []);
  renameSync(lower, upper);
  writeFileSync(join(root, 'Root.md'), 'root');
  const rootProjection = repo.observeProjection(() => { repo.read('Root.md'); renameSync(join(root, 'Root.md'), join(root, 'root.md')); return 'value'; });
  assert.deepEqual(rootProjection.drift.files, ['Root.md']);
  const writer = new LocalRepository(root, { optimistic: true });
  try {
    assert.throws(() => writer.snapshot(() => {
      writer.read('docs/Feature.md'); renameSync(upper, lower);
      writer.publish('edit', [{ path: 'docs/other.md', before: null, after: 'new' }]);
    }), { code: 'PreimageChanged', details: 'source-observation' });
    assert.equal(existsSync(join(root, 'docs/other.md')), false);
    assert.equal(existsSync(join(writer.privateDir, 'journal.json')), false);
  } finally { writer.close(); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C3c: same-size editor atomic save during open rejects queries and projection scans with SourceChanged', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  const repo = reader(t, root);
  const target = join(root, 'src/a.ts');
  for (const projection of [false, true]) {
    const temp = join(root, 'src/new.ts');
    writeFileSync(temp, 'x');
    assert.throws(() => onOpen(target, () => renameSync(temp, target), () => projection
      ? repo.observeProjection(() => repo.read('src/a.ts')) : repo.snapshot(() => repo.read('src/a.ts'))), { code: 'SourceChanged' });
  }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C4: spelling checks reuse listings while every files scan enumerates current members without ancestors', t => Effect.runSync(Effect.sync(() => {
  const { parent, root } = fixture(t);
  for (let index = 0; index < 5000; index++) writeFileSync(join(parent, `wide-${index}`), '');
  for (let index = 0; index < 1000; index++) writeFileSync(join(root, `src/f-${index}.ts`), 'x');
  const original = fs.readdirSync;
  let phase = 'construction';
  const counts = new Map<string, Map<string, number>>();
  fs.readdirSync = ((path, ...args) => {
    const name = String(path);
    const paths = counts.get(phase) ?? new Map<string, number>();
    paths.set(name, (paths.get(name) ?? 0) + 1); counts.set(phase, paths);
    return Reflect.apply(original, fs, [path, ...args]);
  }) as typeof fs.readdirSync;
  syncBuiltinESMExports();
  let repo: LocalRepository | undefined;
  try {
    repo = new LocalRepository(root, { access: 'read' });
    phase = 'read'; repo.beginSnapshot();
    for (let index = 0; index < 1000; index++) assert.equal(repo.read(`src/f-${index}.ts`), 'x');
    assert.equal(repo.files('src').length, 1002);
    assert.equal(repo.files('src').length, 1002);
    phase = 'verify'; repo.verifySnapshot(); repo.endSnapshot();
    const above = (path: string) => root.startsWith(path.endsWith(sep) ? path : `${path}${sep}`);
    for (const part of ['read', 'verify']) for (const [path, count] of counts.get(part) ?? []) {
      assert.equal(above(path), false, `${part} enumerated ancestor ${path}`);
      if (path === root || path.startsWith(`${root}${sep}`)) {
        const scans = path === join(root, 'src') ? part === 'read' ? 2 : 1 : 0;
        assert.ok(count <= 1 + scans, `${part} exceeded one spelling listing plus ${scans} membership scans for ${path}: ${count}`);
      }
    }
    assert.equal(counts.get('read')?.get(join(root, 'src')), (process.platform === 'darwin' ? 1 : 0) + 2);
    assert.equal(counts.get('verify')?.get(join(root, 'src')), (process.platform === 'darwin' ? 1 : 0) + 1);
    const constructionAbove = [...counts.get('construction') ?? []].filter(([path]) => above(path)).reduce((sum, [, count]) => sum + count, 0);
    assert.ok(constructionAbove < 200, `Construction ancestor count exceeded bounded setup: ${constructionAbove}`);
    t.diagnostic(`C4 construction ancestor readdir=${constructionAbove}; read=${JSON.stringify([...counts.get('read') ?? []])}; verify=${JSON.stringify([...counts.get('verify') ?? []])}`);
  } finally { repo?.close(); fs.readdirSync = original; syncBuiltinESMExports(); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('repeated files scans within one snapshot see deleted and newly added members', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  const repo = reader(t, root);
  const observed = repo.observeProjection(() => {
    assert.deepEqual(repo.files('src'), ['src/a.ts', 'src/b.ts']);
    rmSync(join(root, 'src/a.ts'));
    assert.deepEqual(repo.files('src'), ['src/b.ts']);
    writeFileSync(join(root, 'src/new.ts'), 'new');
    assert.deepEqual(repo.files('src'), ['src/b.ts', 'src/new.ts']);
    return 'current members';
  });
  assert.equal(observed.value, 'current members');
  assert.ok(observed.drift.directories.includes('src'));
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C5: Darwin writes keep the full spelling guard inside a snapshot', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  if (!insensitiveDarwin(t, root)) return;
  writeFileSync(join(root, 'docs/feature.md'), 'old');
  const repo = new LocalRepository(root, { optimistic: true });
  try { assert.throws(() => repo.snapshot(() => repo.publish('edit', [{ path: 'docs/Feature.md', before: 'old', after: 'new' }])), { code: 'UnsafePath' }); }
  finally { repo.close(); }
  assert.equal(readFileSync(join(root, 'docs/feature.md'), 'utf8'), 'old');
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C7/C10: optimistic publication creates a directory after planning reads and verifies its own writes', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  const repo = new LocalRepository(root, { optimistic: true });
  try {
    repo.snapshot(() => {
      repo.files('docs');
      const before = repo.read('docs/architecture.md')!;
      const receipt = repo.publish('edit', [{ path: 'docs/new/x.md', before: null, after: 'created' }, { path: 'docs/architecture.md', before, after: '# Updated\n' }]);
      assert.equal(receipt.recoveryRequired, undefined);
      repo.verifySnapshot();
      assert.equal(repo.read('docs/new/x.md'), 'created');
    });
  } finally { repo.close(); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('C8/C9: unscanned sibling additions are harmless and scanned membership additions reject', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  const repo = reader(t, root);
  repo.snapshot(() => { repo.read('src/a.ts'); writeFileSync(join(root, 'src/unrelated.ts'), 'x'); });
  const projection = repo.observeProjection(() => { repo.read('src/a.ts'); writeFileSync(join(root, 'src/other.ts'), 'x'); return 'value'; });
  assert.deepEqual(projection.drift.files, []); assert.deepEqual(projection.drift.directories, []);
  assert.throws(() => repo.snapshot(() => { repo.files('src'); writeFileSync(join(root, 'src/added.ts'), 'x'); }), { code: 'PreimageChanged', details: 'source-observation' });
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('root fd belongs to outer snapshots, closes on failure, and inode replacement verifies as root drift', t => Effect.runSync(Effect.sync(() => {
  const { container, parent, root } = fixture(t);
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const held = new Set<number>();
  let acquired = 0;
  fs.openSync = ((path, ...args) => {
    const fd = Reflect.apply(originalOpen, fs, [path, ...args]);
    if (path === root) { held.add(fd); acquired++; }
    return fd;
  }) as typeof fs.openSync;
  fs.closeSync = fd => { held.delete(fd); originalClose(fd); };
  syncBuiltinESMExports();
  let repo: LocalRepository | undefined;
  try {
    repo = new LocalRepository(root, { access: 'read' });
    assert.equal(held.size, 0); assert.equal(acquired, 1);
    repo.beginSnapshot(); repo.beginSnapshot(); assert.equal(held.size, 1); assert.equal(acquired, 2);
    repo.endSnapshot(); assert.equal(held.size, 1); repo.endSnapshot(); assert.equal(held.size, 0);
    const failure = new Error('reader failure');
    assert.throws(() => repo!.snapshot(() => { throw failure; }), error => error === failure);
    assert.equal(held.size, 0);
    const config = join(root, 'concord.config.ts');
    const source = readFileSync(config, 'utf8');
    writeFileSync(config, 'invalid configuration');
    try { assert.throws(() => new LocalRepository(root, { access: 'read' })); assert.equal(held.size, 0); }
    finally { writeFileSync(config, source); }
    const backup = join(container, 'backup');
    const drift = repo.observeProjection(() => { repo!.read('src/a.ts'); renameSync(parent, backup); mkdirSync(parent); return 'value'; });
    assert.deepEqual(drift.drift.files, ['.']); assert.equal(held.size, 0);
    rmSync(parent, { recursive: true }); renameSync(backup, parent);
  } finally { repo?.close(); fs.openSync = originalOpen; fs.closeSync = originalClose; syncBuiltinESMExports(); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('verification rejects symlinks and nonregular files while atomic replacements report exact projection drift', t => Effect.runSync(Effect.sync(() => {
  const { root } = fixture(t);
  const repo = reader(t, root);
  const target = join(root, 'src/a.ts');
  const replacement = join(dirname(target), 'replacement.ts');
  const projection = repo.observeProjection(() => { repo.read('src/a.ts'); writeFileSync(replacement, 'new'); renameSync(replacement, target); return 'value'; });
  assert.deepEqual(projection.drift.files, ['src/a.ts']);
  assert.throws(() => repo.snapshot(() => { repo.read('src/a.ts'); rmSync(target); symlinkSync(join(root, 'src/b.ts'), target); }), { code: 'UnsafePath' });
  rmSync(target); writeFileSync(target, 'old');
  assert.throws(() => repo.snapshot(() => { repo.read('src/a.ts'); rmSync(target); mkdirSync(target); }), { code: 'UnsafePath' });
  // The kernel APIs remain usable after all snapshot finalizers have run.
  const fd = openSync(join(root, 'src/b.ts'), 'r'); closeSync(fd);
})));
