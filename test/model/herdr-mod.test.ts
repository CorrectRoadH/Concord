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
      const operation = args.slice(args.indexOf('--root') + 2); calls.push(operation);
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
