import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { ModSession, markdownTarget, type ModHost } from '../../src/entry/herdr-mod/index.js';

const path = 'docs/feature/cart/README.md';
const original = '# Cart\n';
function boundary() {
  const files = new Map<string, string>([[`/repo/${path}`, original], ['/repo/docs/taste.md', '# Taste\n']]);
  const calls: string[][] = [], writes: { path: string; expected: string | null }[] = [];
  const host = {
    async exec(command, args) {
      assert.equal(command, 'concord');
      const operation = args.includes('--root') ? args.slice(args.indexOf('--root') + 2) : args.slice(2); calls.push(operation);
      const value = operation[0] === 'doctor' ? { root: '/repo', configuration: { sourceRoots: ['src'], testRoots: ['test'] } }
        : operation[0] === 'list' ? { documents: [{ path, kind: 'feature', title: 'Cart' }] }
        : operation[0] === 'concepts' ? { concepts: [], catalogs: [] }
        : operation[0] === 'show' ? { pages: [{ path, kind: 'readme', name: 'Cart' }], tests: [{ file: 'test/cart.ts', line: 4, name: 'add', contract: `${path}#add` }], codeDeclarations: [] }
        : operation[0] === 'check' ? { ok: false, findings: [{ path, line: 2, message: 'Broken link' }] } : {};
      return { code: operation[0] === 'check' ? 1 : 0, stdout: JSON.stringify(value), stderr: '' };
    },
    async readTextFile(path) { return files.get(path) ?? null; },
    async writeTextFile(path, source, expected) {
      assert.equal(files.get(path) ?? null, expected, 'external native write uses an exact preimage');
      writes.push({ path, expected }); files.set(path, source);
    },
  } satisfies ModHost;
  return { host, files, calls, writes, session: new ModSession(host, '/repo/nested') };
}

// @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md#open
test('only the canonical taste file enables guarded queries, including when other docs exist', async () => {
  const b = boundary(); b.files.clear(); b.files.set('/repo/docs/architecture.md', '# Existing architecture\n');
  const execute = b.host.exec;
  b.host.exec = async (command, args) => {
    assert.equal(args.at(-1), 'doctor', 'uninitialized repositories must not run guarded queries');
    assert.equal(args.includes('--root'), false, 'doctor discovers the Git top from the pane cwd');
    b.calls.push(['doctor']);
    return { code: 0, stdout: JSON.stringify({ root: '/repo', configuration: {} }), stderr: '' };
  };
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.root, '/repo'); assert.equal(b.session.initialized, false);
  assert.deepEqual(b.session.documents, []); assert.deepEqual(b.session.pages, []);
  assert.equal(b.session.error, ''); assert.deepEqual(b.session.watchRoots, ['docs', 'memory']);
  b.files.set('/repo/docs/taste.md', ''); b.host.exec = execute;
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.initialized, true, 'even an empty taste file is the initialization marker');
  assert.ok(b.calls.some(call => call[0] === 'list'));
  b.files.delete('/repo/docs/taste.md');
  b.host.exec = async () => ({ code: 0, stdout: JSON.stringify({ root: '/repo', configuration: {} }), stderr: '' });
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.initialized, false); assert.deepEqual(b.session.documents, []);
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('an initialized root can publish its feature list while doctor is still running', { timeout: 5000 }, async () => {
  const b = boundary(); b.session.root = '/repo';
  const execute = b.host.exec;
  let release!: () => void, listed!: () => void;
  const pendingDoctor = new Promise<void>(resolve => { release = resolve; });
  const listStarted = new Promise<void>(resolve => { listed = resolve; });
  b.host.exec = async (command, args) => {
    if (args.at(-1) === 'doctor') await pendingDoctor;
    if (args.at(-1) === 'list') listed();
    return execute(command, args);
  };
  const refresh = Effect.runPromise(b.session.refresh());
  await listStarted;
  release(); await refresh;
  assert.equal(b.session.initialized, true);
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md
test('mod observes public CLI schemas, package pages and only fixed or linked Markdown', async () => {
  const b = boundary();
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.root, '/repo'); assert.equal(b.session.initialized, true);
  assert.deepEqual(b.session.watchRoots, ['docs', 'memory', 'src', 'test']);
  assert.ok(b.session.pages.some(page => page.path === path));
  await Effect.runPromise(b.session.open(path));
  assert.equal(b.session.source, original); assert.equal(b.session.detail.tests?.[0]?.file, 'test/cart.ts');
  assert.ok(b.calls.some(call => call[0] === 'taste'));
  assert.equal(markdownTarget(path, 'use-case/add.md#step'), 'docs/feature/cart/use-case/add.md');
  assert.equal(markdownTarget(path, '../../../../outside.md'), undefined);
  assert.equal(markdownTarget(path, 'https://example.com/a.md'), undefined);
  await assert.rejects(Effect.runPromise(b.session.open('../outside.md')));
});

// @use-case docs/feature/herdr-mod/use-case/edit-and-check.md
test('saving sends native CAS preimage then check and preserves a conflicting draft', async () => {
  const b = boundary(); await Effect.runPromise(b.session.open(path));
  await Effect.runPromise(b.session.save('# Cart\n\nEdited\n'));
  assert.deepEqual(b.writes, [{ path: `/repo/${path}`, expected: original }]);
  assert.equal(b.session.check?.ok, false); assert.equal(b.session.check?.findings[0]?.line, 2);
  const saved = b.files.get(`/repo/${path}`)!;
  b.files.set(`/repo/${path}`, '# Agent edits\n');
  await assert.rejects(Effect.runPromise(b.session.save('# My draft\n')));
  assert.equal(b.session.draft, '# My draft\n'); assert.equal(b.session.conflict, true);
  assert.equal(b.files.get(`/repo/${path}`), '# Agent edits\n'); assert.notEqual(saved, b.session.draft);
  assert.equal(b.writes.length, 1);
});

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('refresh retains selection and a draft, reports deletion, and close suppresses in-flight reads', async () => {
  const b = boundary(); await Effect.runPromise(b.session.refresh()); await Effect.runPromise(b.session.open(path));
  b.session.draft = '# Draft'; b.files.set(`/repo/${path}`, '# Changed\n');
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.selected, path); assert.equal(b.session.draft, '# Draft');
  assert.equal(b.session.source, original); assert.equal(b.session.conflict, true);
  b.files.delete(`/repo/${path}`); await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.deleted, true); assert.equal(b.session.draft, '# Draft');
  let finish: ((value: string) => void) | undefined;
  b.host.readTextFile = async () => new Promise(resolve => { finish = resolve; });
  const pending = Effect.runPromise(b.session.open('docs/feature/other/README.md'));
  await Promise.resolve(); b.session.stop(); finish?.('# Other'); await pending;
  assert.equal(b.session.selected, path);
});

// @use-case docs/feature/herdr-mod/use-case/edit-and-check.md
test('an external edit between read and native write is preserved by the host CAS failure', async () => {
  const b = boundary(); await Effect.runPromise(b.session.open(path));
  b.host.writeTextFile = async () => { b.files.set(`/repo/${path}`, '# Concurrent\n'); throw new Error('File changed'); };
  await assert.rejects(Effect.runPromise(b.session.save('# Draft\n')));
  assert.equal(b.session.conflict, true); assert.equal(b.session.draft, '# Draft\n');
  assert.equal(b.files.get(`/repo/${path}`), '# Concurrent\n');
  assert.ok(!b.calls.some(call => call[0] === 'check'));
});

// @use-case docs/feature/herdr-mod/use-case/edit-and-check.md
test('host text limits and command failures remain errors without replacing a draft or writing', async () => {
  const b = boundary(); await Effect.runPromise(b.session.open(path));
  b.host.writeTextFile = async () => { throw new Error('Text file exceeds 1 MiB'); };
  await assert.rejects(Effect.runPromise(b.session.save('# Oversized draft\n')), /Text file exceeds 1 MiB/u);
  assert.equal(b.session.draft, '# Oversized draft\n'); assert.equal(b.session.conflict, true);
  assert.equal(b.files.get(`/repo/${path}`), original);
  assert.ok(!b.calls.some(call => call[0] === 'check'));
  b.host.exec = async () => { throw new Error('cannot start concord'); };
  await assert.rejects(Effect.runPromise(b.session.refresh()), /cannot start concord/u);
  assert.equal(b.session.draft, '# Oversized draft\n');
});
