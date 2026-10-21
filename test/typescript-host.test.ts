import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeOwnedProcessService } from '../dist/owned-process.js';
import { Effect } from 'effect';
import { withTypeScript, withTypeScriptFiles, withTypeScriptSource } from '../dist/typescript-host.js';

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
test('owned editor job timeout releases its real native compiler group', { skip: process.platform !== 'linux', timeout: 15000 }, () => Effect.runPromise(Effect.gen(function*() {
  const owner = makeOwnedProcessService();
  let ready = false;
  const result = yield* Effect.scoped(owner.run([process.execPath, '--import', 'tsx', fileURLToPath(new URL('./fixtures/typescript-scope-worker.ts', import.meta.url))], {
    cwd: process.cwd(), timeoutMs: 2500,
    stream: { ready: (_write, end) => end(), stdout: chunk => { if (chunk.toString().includes('compiler-ready')) ready = true; } },
  }));
  assert.equal(ready, true, 'fixture must hold a real TypeScript scope before timeout');
  assert.equal(result.timedOut, true);
  assert.equal(result.processGroupOwned, true);
  assert.equal(result.groupCleanup.checked, true);
  assert.equal(result.groupCleanup.gone, true);
  const remaining = readdirSync('/proc').filter(name => /^\d+$/u.test(name)).flatMap(pid => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
      return Number(stat[2]) === result.groupCleanup.groupId && stat[0] !== 'Z' && stat[0] !== 'X' ? [pid] : [];
    } catch { return []; }
  });
  assert.deepEqual(remaining, []);
})));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('native compiler scopes isolate captured config inputs and preserve syntax diagnostics', () => Effect.runPromise(Effect.sync(() => {
  const result = withTypeScriptSource('source.ts', 'const x = ;', (source, diagnostics) => ({ statements: source.statements.length, diagnostics: diagnostics.map(d => ({ text: d.text, pos: d.pos })) }));
  assert.equal(result.statements, 1);
  assert.ok(result.diagnostics.some(d => d.text === 'Expression expected.' && d.pos === 10));
  withTypeScriptFiles(new Map([
    ['/captured/tsconfig.json', '{"extends":"./base.json","files":["source.ts"]}'],
    ['/captured/base.json', '{"compilerOptions":{"strict":true}}'],
    ['/captured/source.ts', 'export const answer = 42;'],
  ]), api => {
    assert.equal(api.parseConfigFile('/captured/tsconfig.json').options.strict, true);
    assert.ok(api.readConfigFile('/etc/passwd').error);
    assert.ok(api.readConfigFile(`${process.cwd()}/package.json`).error);
  }, '/captured');
})));

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
test('native compiler closes after nested domain failure and snapshot disposal failure', () => Effect.runPromise(Effect.sync(() => {
  let closed = 0;
  const domainError = new Error('domain failure');
  assert.throws(() => withTypeScriptFiles(new Map(), api => {
    const close = api.close;
    Object.defineProperty(api, 'close', { value: () => { closed++; close(); } });
    return withTypeScriptSource('test.ts', 'const answer = 42;', () => { throw domainError; });
  }), error => error === domainError);
  assert.equal(closed, 1);
  assert.throws(() => withTypeScriptFiles(new Map(), api => {
    const close = api.close;
    Object.defineProperty(api, 'close', { value: () => { closed++; close(); } });
    const createSnapshot = api.createSnapshot;
    Object.defineProperty(api, 'createSnapshot', { value: (...args: Parameters<typeof createSnapshot>) => {
      const snapshot = createSnapshot(...args);
      const dispose = snapshot.dispose;
      Object.defineProperty(snapshot, 'dispose', { value: () => { dispose(); throw new Error('disposal failure'); } });
      return snapshot;
    } });
    return withTypeScriptSource('test.ts', 'const answer = 42;', source => source.statements.length);
  }), { code: 'TypeScriptUnavailable' });
  assert.equal(closed, 2);
  assert.equal(withTypeScriptSource('next.ts', 'const next = 1;', source => source.statements.length), 1);
})));

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
test('editor verifies cleanup records only after Scope release and rejects every unconfirmed ownership state', { skip: process.platform === 'win32' }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const { runEditorJob } = await import('../dist/editor-job.js');
  const computed = { generation: 0, revision: '', config: 'fixture', complete: true, gaps: [], value: null, diagnostics: [], reads: [], listings: [] };
  const job = { root: process.cwd(), generation: 0, config: 'fixture', revision: '', overlays: [], method: 'diagnostics' };
  const { makeOwnedProcessService } = await import('../dist/owned-process.js');
  type Result = import('../dist/owned-process.js').OwnedProcessResult;
  const confirmed: Result = { command: ['fixture'], exitCode: 0, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout: JSON.stringify({ ok: true, result: computed }), stderr: '', outputBytes: 0, processGroupOwned: true, groupCleanup: { owned: true, checked: true, gone: true, aliveAfterLeaderClose: false, signalsSent: [], detail: 'fixture' } };
  const variants: readonly (Result | undefined)[] = [confirmed, { ...confirmed, processGroupOwned: false }, { ...confirmed, groupCleanup: { ...confirmed.groupCleanup, owned: false } }, { ...confirmed, groupCleanup: { ...confirmed.groupCleanup, checked: false } }, { ...confirmed, groupCleanup: { ...confirmed.groupCleanup, gone: false } }, { ...confirmed, groupCleanup: { ...confirmed.groupCleanup, gone: null } }, undefined];
  for (const record of variants) {
    let released = false, failures = 0;
    const service = { ...makeOwnedProcessService(), run: () => Effect.acquireRelease(Effect.succeed(confirmed), () => Effect.sync(() => { released = true; })), cleanupResults: Effect.sync(() => {
      assert.equal(released, true, 'cleanup is inspected after Scope finalizers');
      return record === undefined ? [] : [record];
    }) };
    const promise = Effect.runPromise(runEditorJob(job, () => { failures++; }, service));
    if (record === confirmed) { assert.deepEqual(await promise, computed); assert.equal(failures, 0); }
    else { await assert.rejects(promise, /cleanup could not be confirmed/u); assert.equal(failures, 1); }
  }
})));
