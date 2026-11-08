import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { digest } from '../../src/model/index.ts';
import { ModSession, markdownTarget, type ModHost } from '../../src/entry/herdr-mod/index.ts';

const path = 'docs/feature/cart/README.md';
const original = '# Cart\n';
function boundary() {
  const files = new Map<string, string>([[`/repo/${path}`, original], ['/repo/docs/taste.md', '# Taste\n']]);
  const calls: string[][] = [], writes: { path: string; expected: string | null }[] = [];
  const host = {
    async exec(command, args, options) {
      assert.equal(command, 'concord');
      const operation = args.includes('--root') ? args.slice(args.indexOf('--root') + 2) : args.slice(2); calls.push(operation);
      if (operation[0] === 'action') {
        const input = JSON.parse(operation.filter(value => value.startsWith('--input-text=')).map(value => value.slice('--input-text='.length)).join('')) as { action: string; path: string; body: string; expectedDigest: string };
        const absolute = `${options.cwd}/${input.path}`, source = files.get(absolute);
        const error = (name: string) => ({ code: 1, stdout: '', stderr: JSON.stringify({ error: name, message: name }) });
        if (input.action === 'file.get') return source === undefined ? error('FileNotFound') : { code: 0, stdout: JSON.stringify({ path: input.path, body: source, digest: digest(source) }), stderr: '' };
        if (source === undefined || digest(source) !== input.expectedDigest) return error('FileChangedSinceRead');
        writes.push({ path: absolute, expected: input.expectedDigest }); files.set(absolute, input.body);
        return { code: 0, stdout: JSON.stringify({ changedPaths: [input.path] }), stderr: '' };
      }
      const value = operation[0] === 'doctor' ? { root: '/repo', configuration: { sourceRoots: ['src'], testRoots: ['test'] } }
        : operation[0] === 'list' ? { documents: [{ path, kind: 'feature', title: 'Cart' }] }
        : operation[0] === 'concepts' ? { concepts: [], catalogs: [] }
        : operation[0] === 'show' ? { pages: [{ path, kind: 'readme', name: 'Cart' }], tests: [{ file: 'test/cart.ts', line: 4, name: 'add', contract: `${path}#add` }], codeDeclarations: [] }
        : operation[0] === 'check' ? { ok: false, findings: [{ path, line: 2, message: 'Broken link' }] } : {};
      return { code: operation[0] === 'check' ? 1 : 0, stdout: JSON.stringify(value), stderr: '' };
    },
  } satisfies ModHost;
  return { host, files, calls, writes, session: new ModSession(host, '/repo/nested') };
}

// @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md#open
test('only the canonical taste file enables guarded queries, including when other docs exist', async () => {
  const b = boundary(); b.files.clear(); b.files.set('/repo/docs/architecture.md', '# Existing architecture\n');
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.root, '/repo'); assert.equal(b.session.initialized, false);
  assert.deepEqual(b.session.documents, []); assert.deepEqual(b.session.pages, []);
  assert.equal(b.session.error, '');
  b.files.set('/repo/docs/taste.md', '');
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.initialized, true, 'even an empty taste file is the initialization marker');
  assert.ok(b.calls.some(call => call[0] === 'list'));
  b.files.delete('/repo/docs/taste.md');
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
  b.host.exec = async (command, args, options) => {
    if (args.at(-1) === 'doctor') await pendingDoctor;
    if (args.at(-1) === 'list') listed();
    return execute(command, args, options);
  };
  const refresh = Effect.runPromise(b.session.refresh());
  await listStarted;
  release(); await refresh;
  assert.equal(b.session.initialized, true);
});

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('refresh publishes a changed page before its slower relationship query completes', { timeout: 5000 }, async () => {
  const b = boundary(); await Effect.runPromise(b.session.refresh()); await Effect.runPromise(b.session.open(path));
  b.files.set(`/repo/${path}`, '# Fresh page\n');
  const execute = b.host.exec;
  let release!: () => void, observed!: () => void;
  const relationship = new Promise<void>(resolve => { release = resolve; });
  const source = new Promise<void>(resolve => { observed = resolve; });
  b.host.exec = async (command, args, options) => {
    if (args.includes('show')) await relationship;
    return execute(command, args, options);
  };
  const refresh = Effect.runPromise(b.session.refresh(() => { if (b.session.source === '# Fresh page\n') observed(); }));
  try { await source; assert.equal(b.session.sourceDigest, digest('# Fresh page\n')); }
  finally { release(); await refresh; }
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md
test('mod observes public CLI schemas, package pages and only fixed or linked Markdown', async () => {
  const b = boundary();
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.root, '/repo'); assert.equal(b.session.initialized, true);
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
test('saving reads the current CLI digest and overwrites an unobserved external edit before checking', async () => {
  const b = boundary(); await Effect.runPromise(b.session.open(path));
  await Effect.runPromise(b.session.save('# Cart\n\nEdited\n'));
  assert.deepEqual(b.writes, [{ path: `/repo/${path}`, expected: digest(original) }]);
  assert.equal(b.session.check?.ok, false); assert.equal(b.session.check?.findings[0]?.line, 2);
  b.files.set(`/repo/${path}`, '# Agent edits\n');
  await Effect.runPromise(b.session.save('# My draft\n'));
  assert.equal(b.session.draft, undefined);
  assert.equal(b.files.get(`/repo/${path}`), '# My draft\n');
  assert.equal(b.writes[1]?.expected, digest('# Agent edits\n'));
  assert.equal(b.writes.length, 2);
});

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('refresh retains selection, replaces the draft, reports deletion, and close suppresses in-flight reads', async () => {
  const b = boundary(); await Effect.runPromise(b.session.refresh()); await Effect.runPromise(b.session.open(path));
  b.session.draft = '# Draft'; b.files.set(`/repo/${path}`, '# Changed\n');
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.selected, path); assert.equal(b.session.draft, undefined);
  assert.equal(b.session.source, '# Changed\n');
  b.files.delete(`/repo/${path}`); await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.deleted, true); assert.equal(b.session.draft, undefined);
  let finish: ((value: { code: number; stdout: string; stderr: string }) => void) | undefined;
  b.host.exec = async () => new Promise(resolve => { finish = resolve; });
  const pending = Effect.runPromise(b.session.open('docs/feature/other/README.md'));
  await Promise.resolve(); b.session.stop(); finish?.({ code: 0, stdout: JSON.stringify({ path: 'docs/feature/other/README.md', body: '# Other', digest: digest('# Other') }), stderr: '' }); await pending;
  assert.equal(b.session.selected, path);
});

// @use-case docs/feature/herdr-mod/use-case/edit-and-check.md
test('CLI failures retain a draft without authorizing a write or running check', async () => {
  const b = boundary(); await Effect.runPromise(b.session.open(path));
  b.host.exec = async () => ({ code: 1, stdout: '', stderr: JSON.stringify({ error: 'InvalidBody', message: 'Body is too large' }) });
  await assert.rejects(Effect.runPromise(b.session.save('# Oversized draft\n')), /Body is too large/u);
  assert.equal(b.session.draft, '# Oversized draft\n');
  assert.equal(b.files.get(`/repo/${path}`), original);
  assert.ok(!b.calls.some(call => call[0] === 'check'));
  b.host.exec = async () => { throw new Error('cannot start concord'); };
  await assert.rejects(Effect.runPromise(b.session.refresh()), /Concord 命令失败/u);
  assert.equal(b.session.draft, '# Oversized draft\n');
});

// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#edit
test('remote drafts use the same digest action and UTF-8 bounded argument chunks', async () => {
  const b = boundary(); b.session = new ModSession(b.host, '/repo', 'vps');
  const execute = b.host.exec;
  b.host.exec = async (command, args, options) => {
    assert.equal(options.on, 'vps');
    for (const arg of args) if (arg.startsWith('--input-text=')) assert.ok(Buffer.byteLength(arg) <= 64 * 1024);
    return execute(command, args, options);
  };
  await Effect.runPromise(b.session.open(path));
  const draft = '# Cart\n' + '中文🙂'.repeat(20_000);
  await Effect.runPromise(b.session.save(draft));
  assert.equal(b.files.get(`/repo/${path}`), draft);
  assert.ok(b.calls.some(call => call.filter(arg => arg.startsWith('--input-text=')).length > 1));
  assert.equal(b.session.sourceDigest, digest(draft));
});
