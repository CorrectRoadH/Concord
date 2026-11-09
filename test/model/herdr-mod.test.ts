import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { digest } from '../../src/model/index.ts';
import { ModFailure, ModSession, markdownTarget, type ModHost } from '../../src/entry/herdr-mod/index.ts';


/** Public projection payload emitted by the simulated CLI boundary. */
function modProjection(root: string, files: ReadonlyMap<string, string>, documents: readonly { path: string; kind: string; title: string }[], pages: readonly { path: string; name: string }[] = [], relationships: { tests: readonly { file: string; line: number; name: string; contract: string }[]; codeDeclarations: readonly { file: string; line: number; symbol?: string; contracts: readonly string[] }[] } = { tests: [], codeDeclarations: [] }, concepts: readonly { path: string; concept: { id: string; term: string } }[] = []) {
  const sources = [...files].filter(([path]) => path.startsWith(`${root}/`)).map(([path, body]) => ({ path: path.slice(root.length + 1), digest: digest(body) }));
  const catalogs = [...new Set(concepts.map(item => item.path))].map(path => ({ path, concepts: concepts.filter(item => item.path === path).map(item => ({ id: item.concept.id, term: item.concept.term, deprecated: [] })) }));
  const snapshot = {
    complete: true, root, project: null, configDigest: null, conceptCatalogs: catalogs,
    documents: documents.map(document => ({ path: document.path, digest: 'document', metadata: { format: 'concord.document/v1', id: document.path, ...document } })),
    feedback: [], pages: [...new Map([...sources.filter(source => source.path.endsWith('.md')).map(source => ({ ...source, derivedTitle: /^#\s+(.+)$/mu.exec(files.get(`${root}/${source.path}`) ?? '')?.[1] })), ...pages.map(page => ({ path: page.path, digest: 'page', derivedTitle: /^#\s+(.+)$/mu.exec(files.get(`${root}/${page.path}`) ?? '')?.[1] ?? page.name }))].map(page => [page.path, page])).values()],
    cases: relationships.tests.map((item, index) => ({ ...item, id: `neref_${String(index).padStart(32, '0')}`, contractKind: 'feature', issues: [], status: 'active', framework: 'marker', skipped: false })),
    codes: relationships.codeDeclarations.map((item, index) => ({ ...item, id: `code-${index}`, endLine: item.line, scope: 'file' })),
    edges: [], findings: [], sources, evidenceIds: [], templates: [], cache: { status: 'ready' }, diagnostics: { error: '', message: '' },
  };
  const at = '2026-11-08T00:00:00.000Z';
  return { snapshot, projection: { sourceDigest: digest(JSON.stringify(snapshot)), builtAt: at, builtFrom: at, builtUntil: at, complete: true, changedPaths: [], unknownRelations: false, status: 'ready', current: false, refreshOwner: 'active' } };
}

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
      if (operation[0] === 'workspace' && operation[1] === 'projection') {
        if (!files.has('/repo/docs/taste.md')) return { code: 1, stdout: '', stderr: JSON.stringify({ error: 'ProjectNotInitialized', message: 'Not initialized' }) };
        return { code: 0, stdout: JSON.stringify(modProjection('/repo', files, [{ path, kind: 'feature', title: 'Cart' }], [{ path, name: 'Cart' }], { tests: [{ file: 'test/cart.ts', line: 4, name: 'add', contract: `${path}#add` }], codeDeclarations: [] })), stderr: '' };
      }
      const value = operation[0] === 'check' ? { ok: false, findings: [{ path, line: 2, message: 'Broken link' }] } : {};
      return { code: operation[0] === 'check' ? 1 : 0, stdout: JSON.stringify(value), stderr: '' };
    },
  } satisfies ModHost;
  return { host, files, calls, writes, session: new ModSession(host, '/repo') };
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
  assert.ok(b.calls.some(call => call[0] === 'workspace' && call[1] === 'projection'));
  b.files.delete('/repo/docs/taste.md');
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.initialized, false); assert.deepEqual(b.session.documents, []);
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md#open-feature
test('one refresh reads only one projection regardless of the document count', async () => {
  const b = boundary();
  await Effect.runPromise(b.session.refresh());
  assert.deepEqual(b.calls, [['workspace', 'projection']]);
  assert.equal(b.session.initialized, true);
});

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('refresh reads a changed selected page after accepting the new projection', async () => {
  const b = boundary(); await Effect.runPromise(b.session.refresh()); await Effect.runPromise(b.session.open(path));
  b.files.set(`/repo/${path}`, '# Fresh page\n');
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.source, '# Fresh page\n');
  assert.equal(b.calls.filter(call => call[0] === 'show').length, 0);
});

// @use-case docs/feature/herdr-mod/use-case/read-spec.md
test('mod observes public CLI schemas, package pages and only fixed or linked Markdown', async () => {
  const b = boundary();
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.root, '/repo'); assert.equal(b.session.initialized, true);
  assert.ok(b.session.pages.some(page => page.path === path));
  await Effect.runPromise(b.session.open(path));
  assert.equal(b.session.source, original); assert.equal(b.session.detail.tests?.[0]?.file, 'test/cart.ts');
  assert.ok(!b.calls.some(call => call[0] === 'taste'));
  await Effect.runPromise(b.session.open('docs/taste.md'));
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

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('pending projections wait without after before reading again, and unavailable services scan once', async () => {
  for (const unavailable of [false, true]) {
    const b = boundary(); const execute = b.host.exec;
    let first = true;
    b.host.exec = async (command, args, options) => {
      assert.ok(!args.includes('--fresh'));
      const operation = args.slice(args.indexOf('--root') + 2);
      if (operation[0] === 'workspace' && first) {
        first = false; b.calls.push(operation);
        return { code: 1, stdout: '', stderr: JSON.stringify({ error: unavailable ? 'WorkspaceProjectionUnavailable' : 'WorkspaceProjectionPending', message: 'Not ready' }) };
      }
      if (operation[1] === 'wait') {
        b.calls.push(operation); assert.deepEqual(operation, ['workspace', 'wait']);
        return { code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'ready' }), stderr: '' };
      }
      if (operation[1] === 'show') {
        b.calls.push(operation);
        return { code: 0, stdout: JSON.stringify(modProjection('/repo', b.files, [{ path, kind: 'feature', title: 'Cart' }]).snapshot), stderr: '' };
      }
      return execute(command, args, options);
    };
    await Effect.runPromise(b.session.refresh());
    assert.equal(b.session.initialized, true);
    assert.deepEqual(b.calls, unavailable ? [['workspace', 'projection'], ['workspace', 'show']] : [['workspace', 'projection'], ['workspace', 'wait'], ['workspace', 'projection']]);
  }
});

// @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md#init
test('initialization keeps waiting if its first wake-up precedes a readable projection', async () => {
  const b = boundary(); const execute = b.host.exec;
  let attempts = 0;
  b.host.exec = async (command, args, options) => {
    const operation = args.slice(args.indexOf('--root') + 2);
    if (operation[1] === 'projection' && attempts++ < 2) {
      b.calls.push(operation);
      return { code: 1, stdout: '', stderr: JSON.stringify({ error: 'WorkspaceProjectionPending', message: 'Workspace is building' }) };
    }
    if (operation[1] === 'wait') {
      b.calls.push(operation);
      return { code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'initializing' }), stderr: '' };
    }
    return execute(command, args, options);
  };
  await Effect.runPromise(b.session.refresh());
  assert.equal(b.session.initialized, true);
  assert.deepEqual(b.calls, [['workspace', 'projection'], ['workspace', 'wait'], ['workspace', 'projection'], ['workspace', 'wait'], ['workspace', 'projection']]);
});

// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
// @issue docs/issues/herdr-remote-service-lifetime.md
test('remote cold loading keeps its service outside short execs and confirms its handshake before waiting', async () => {
  const b = boundary(), execute = b.host.exec;
  let managed = false, handshaken = false, projections = 0;
  const control: string[][] = [];
  b.host.exec = async (command, args, options) => {
    assert.deepEqual(options, { cwd: '/repo', on: 'vps' });
    if (command === 'hc') {
      control.push(args);
      managed = true;
      return { code: 0, stdout: '{"address":"t1"}', stderr: '' };
    }
    const operation = args.slice(args.indexOf('--root') + 2);
    if (operation[0] === 'server') {
      control.push(operation);
      if (operation.includes('--wait')) handshaken = managed;
      return { code: 0, stdout: JSON.stringify({ operation: 'server-status', state: managed ? 'opening' : 'absent' }), stderr: '' };
    }
    if (operation[1] === 'projection' && !managed) {
      return { code: 1, stdout: '', stderr: JSON.stringify({ error: ++projections > 3 ? 'ProbeLimit' : 'WorkspaceProjectionPending', message: 'Workspace is opening' }) };
    }
    if (operation[1] === 'wait') {
      if (managed) assert.equal(handshaken, true, 'a terminal receipt is not a service handshake');
      return { code: 0, stdout: JSON.stringify({ changed: true, sourceDigest: 'ready' }), stderr: '' };
    }
    return execute(command, args, options);
  };
  const session = new ModSession(b.host, '/repo', 'vps');
  await Effect.runPromise(session.refresh());
  assert.deepEqual(session.documents.map(document => document.path), [path]);
  assert.deepEqual(control, [
    ['server', 'status'],
    ['run', '--bg', '--no-parent', '--rm', '--', 'concord', 'server', 'run', '--root', '/repo'],
    ['server', 'status', '--wait'],
  ]);
});

// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
// @issue docs/issues/herdr-remote-service-lifetime.md
test('unreadable initial projections report pending after two waits instead of looping', async () => {
  let projections = 0, waits = 0;
  const session = new ModSession({ exec: async (_command, args) => {
    const operation = args.slice(args.indexOf('--root') + 2);
    if (operation[1] === 'wait') { waits++; return { code: 0, stdout: JSON.stringify({ changed: false, sourceDigest: 'old' }), stderr: '' }; }
    return { code: 1, stdout: '', stderr: JSON.stringify({ error: ++projections > 3 ? 'ProbeLimit' : 'WorkspaceProjectionPending', message: 'Workspace is opening' }) };
  } }, '/repo');
  await assert.rejects(Effect.runPromise(session.refresh()), error => error instanceof ModFailure && error.code === 'WorkspaceProjectionPending');
  assert.equal(projections, 3); assert.equal(waits, 2); assert.equal(session.loaded, false);
});

// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
test('remote waits reuse an existing service and keep the observed digest', async () => {
  const calls: string[][] = [];
  const session = new ModSession({ exec: async (command, args) => {
    assert.equal(command, 'concord');
    const operation = args.slice(args.indexOf('--root') + 2); calls.push(operation);
    return { code: 0, stdout: JSON.stringify(operation[0] === 'server' ? { state: 'running' } : { changed: false, sourceDigest: 'kept' }), stderr: '' };
  } }, '/repo', 'vps');
  session.workspaceDigest = 'kept';
  assert.deepEqual(await Effect.runPromise(session.wait()), { changed: false, sourceDigest: 'kept' });
  assert.deepEqual(calls, [['server', 'status'], ['workspace', 'wait', '--after', 'kept']]);
});

// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
test('remote hosting failure preserves the host output as a named failure', async () => {
  const session = new ModSession({ exec: async (command, args) => command === 'hc'
    ? { code: 1, stdout: '', stderr: 'terminal quota exceeded' }
    : { code: 0, stdout: JSON.stringify(args.includes('status') ? { state: 'absent' } : { changed: false, sourceDigest: 'old' }), stderr: '' },
  }, '/repo', 'vps');
  await assert.rejects(Effect.runPromise(session.wait()), error => error instanceof ModFailure && error.code === 'HerdrServiceStartFailed' && error.details === 'terminal quota exceeded');
});
