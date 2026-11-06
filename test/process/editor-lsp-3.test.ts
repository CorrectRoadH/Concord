// 跨进程保证：进程终止与信号——真实编译任务取消后被回收且不留僵尸，清理失败时shutdown或EOF不能成功退出。
import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
test('editor retains cleanup failure after cancellation and rejects shutdown and EOF success', { skip: process.platform === 'win32', timeout: 60000 }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = consumer();
  const c = new Client(root, [fileURLToPath(new URL('../fixtures/editor-cleanup-failure.ts', import.meta.url)), root]);
  try {
    await c.initialize();
    c.open('test/flow.ts', testText(reference));
    const request = c.request('textDocument/definition', c.query('test/flow.ts', 1, 20));
    // Observe the real spawn before cancellation; elapsed time cannot prove it.
    await c.wait(() => c.stderr.includes('test-editor-job-started') ? true : undefined);
    c.send('$/cancelRequest', { id: request.id });
    const reply = await request.response;
    assert.ok(reply.error !== undefined);
    await c.diagnostic('test/flow.ts', 1);
    const blocked = await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response;
    assert.match(JSON.stringify(blocked.error), /EditorTaskFailed/u);
    const shutdown = await c.request('shutdown').response;
    assert.match(JSON.stringify(shutdown.error), /EditorTaskFailed/u);
    c.child.stdin.end();
    assert.notEqual(await c.closed, 0);
    assert.match(c.stderr, /EditorTaskFailed|cleanup could not be confirmed/u);
  } finally {
    if (c.child.exitCode === null && c.child.signalCode === null) { c.child.kill('SIGKILL'); await c.closed; }
  }
})));

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
test('packed editor repeatedly cancels real compiler jobs without leaving editor-owned zombies', { skip: process.platform !== 'linux', timeout: 60000 }, () => run(async c => {
  const processes = () => readdirSync('/proc').filter(pid => /^\d+$/u.test(pid)).flatMap(pid => {
    try {
      const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
      return [{ pid: Number(pid), parent: Number(fields[1]), state: fields[0], command: readFileSync(`/proc/${pid}/cmdline`, 'utf8') }];
    } catch { return []; }
  });
  const text = codeText(reference) + 'const value = 1;\n'.repeat(80000);
  for (let cycle = 0; cycle < 3; cycle++) {
    c.open('src/flow.ts', text);
    const request = c.request('textDocument/hover', c.query('src/flow.ts', 1, 25));
    let observed = false;
    for (let attempt = 0; attempt < 500; attempt++) {
      const all = processes(), jobs = all.filter(p => p.parent === c.child.pid).map(p => p.pid);
      if (all.some(p => jobs.includes(p.parent) && /typescript[^\0]*\/lib\/tsc\0/u.test(p.command))) { observed = true; break; }
      await Effect.runPromise(Effect.sleep('10 millis'));
    }
    assert.equal(observed, true, 'cancellation must interrupt an actual native compiler job');
    c.send('$/cancelRequest', { id: request.id });
    assert.equal((await request.response).error?.code, -32800);
    c.close('src/flow.ts');
    for (let attempt = 0; attempt < 300 && processes().some(p => p.parent === c.child.pid); attempt++) await Effect.runPromise(Effect.sleep('10 millis'));
    assert.deepEqual(processes().filter(p => p.parent === c.child.pid), [], 'long-lived editor must reap its direct children after every cancellation');
  }
  assert.equal(await c.result('shutdown'), null);
  assert.deepEqual(processes().filter(p => p.parent === c.child.pid), []);
  c.send('exit');
  assert.equal(await c.closed, 0);
}));

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
test('editor EOF retains a cleanup failure first observed after the transport ended', { skip: process.platform === 'win32', timeout: 60000 }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = consumer();
  const c = new Client(root, [fileURLToPath(new URL('../fixtures/editor-cleanup-failure.ts', import.meta.url)), root]);
  try {
    await c.initialize();
    c.open('src/flow.ts', codeText(reference) + 'const value = 1;\n'.repeat(80000));
    await c.wait(() => c.stderr.includes('test-editor-job-started') ? true : undefined);
    c.child.stdin.end();
    assert.notEqual(await c.closed, 0);
    assert.match(c.stderr, /cleanup could not be confirmed/u);
  } finally {
    if (c.child.exitCode === null && c.child.signalCode === null) { c.child.kill('SIGKILL'); await c.closed; }
  }
})));
