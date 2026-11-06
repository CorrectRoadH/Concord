import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { test } from 'node:test';
import { Effect } from 'effect';
import { acquireBrowserSharedFixture } from '../support/browser-shared-fixture.ts';
import { fetchFresh, parseWorkspaceProjection } from '../support/support.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { installedConcordCli, pollUntil } from '../support/support.ts';

for (const mode of ['success', 'assertion-failure', 'timeout'] as const) {
  // @feature docs/engineering/testing/architecture.md#浏览器与诊断
  // @issue docs/issues/server-stop-before-process-exit.md
  test(`shared browser service restores its frozen fixture and releases process and worktree after ${mode}`, () => Effect.runPromise(Effect.gen(function*() {
    let root: string | undefined;
    let pid: number | undefined;
    let service: ReturnType<typeof record> | undefined;
    let reachedOutcome = false;
    const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function*() {
      const fixture = yield* acquireBrowserSharedFixture();
      root = fixture.root;
      pid = fixture.server.process.pid;
      service = record(fixture.root);
      yield* Effect.tryPromise(async () => {
        const url = new URL('/api/workspace', fixture.server.address);
        const before = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
        const server = fixture.server;
        writeFileSync(join(fixture.root, 'docs/extra.md'), '# Added between cases\n');
        await fixture.ready();
        await fixture.restore();
        assert.equal(fixture.server, server);
        assert.equal(fixture.server.process.pid, pid);
        assert.equal(record(fixture.root).pid, service?.pid, 'restoring a case keeps the worker service process');
        assert.equal(record(fixture.root).token, service?.token, 'restoring a case keeps the service instance');
        assert.equal(existsSync(join(fixture.root, 'docs/extra.md')), false);
        const after = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
        assert.equal(after.projection.sourceDigest, before.projection.sourceDigest);
      });
      reachedOutcome = true;
      if (mode === 'assertion-failure') yield* Effect.sync(() => assert.fail('Intentional lifecycle failure'));
      if (mode === 'timeout') yield* Effect.never.pipe(Effect.timeout(1));
    })));
    assert.equal(reachedOutcome, true, 'fixture body reached its intended outcome');
    assert.equal(exit._tag, mode === 'success' ? 'Success' : 'Failure', inspect(exit, { depth: 8 }));
    assert.ok(root && pid);
    assert.equal(existsSync(root), false, 'scope deletes the stopped service worktree');
    const stoppedPid = pid;
    assert.throws(() => process.kill(stoppedPid, 0), { code: 'ESRCH' }, 'scope waits for service exit');
    assert.ok(service);
    assert.equal(existsSync(service.socket.path), false, 'scope removes the service socket outside the worktree');
    const stoppedServicePid = service.pid;
    let processState = 'gone', exited = false;
    try {
      process.kill(stoppedServicePid, 0);
      if (process.platform === 'linux') {
        processState = readFileSync(`/proc/${stoppedServicePid}/stat`, 'utf8');
        exited = /^[ZX] /u.test(processState.slice(processState.lastIndexOf(')') + 2));
      }
    } catch (cause) {
      if (!['ESRCH', 'ENOENT'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause;
      exited = true;
    }
    assert.equal(exited, true, `scope waits for the workspace service process: ${processState}`);
  })));
}

// @feature docs/feature/local-sdlc/cli.md
// @issue docs/issues/server-stop-before-process-exit.md
test('server stop refuses success while the recorded service is still exiting after releasing its lock', async () => {
  const root = fixture();
  const marker = join(root, 'exiting');
  const release = join(root, 'release');
  const preload = join(root, 'exit-barrier.mjs');
  // A real service reaches its exit handler after releasing all service resources.
  // The external child is an explicit barrier, released in finally, not a sleep.
  writeFileSync(preload, `
    import { writeFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    if (process.argv.includes('server') && process.argv.includes('run')) {
      process.once('exit', () => {
        writeFileSync(${JSON.stringify(marker)}, 'exiting');
        spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify("import { existsSync, watch } from 'node:fs'; const release = process.argv[1]; if (!existsSync(release)) { const watcher = watch(release.slice(0, release.lastIndexOf('/')), () => { if (existsSync(release)) watcher.close(); }); if (existsSync(release)) watcher.close(); }")}, ${JSON.stringify(release)}], { env: { ...process.env, NODE_OPTIONS: '' } });
      });
    }
  `);
  let firstStop: Promise<{ status: number | null; stdout: string; stderr: string }> | undefined;
  try {
    const child = spawn(process.execPath, [installedConcordCli(), '--root', root, '--json', 'server', 'start'], {
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}` }, stdio: 'pipe',
    });
    let output = '';
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    const started = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(started, 0, output);
    const owner = record(root);
    const original = JSON.parse(readFileSync(recordPath(root), 'utf8'));
    firstStop = command(root, ['server', 'stop']);
    await pollUntil(async () => existsSync(marker) ? true : undefined, { description: 'real service reached the exit barrier', timeoutMs: 8000 });
    // Reconstruct the residual stopping record to exercise a second caller after
    // lock release. Its PID and lock identity belong to the actual service.
    writeFileSync(recordPath(root), JSON.stringify({ ...original, state: 'stopping' }));
    const result = await command(root, ['server', 'stop']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stderr || result.stdout).error, 'CleanupFailed');
    assert.doesNotThrow(() => process.kill(owner.pid, 0), 'the barrier keeps the real service alive');
  } finally {
    writeFileSync(release, 'release');
    await firstStop;
    rmSync(recordPath(root), { force: true });
    await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});
