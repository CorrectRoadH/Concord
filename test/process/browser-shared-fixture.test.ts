import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { test } from 'node:test';
import { Effect } from 'effect';
import { acquireBrowserSharedFixture } from '../support/browser-shared-fixture.js';
import { fetchFresh, parseWorkspaceProjection } from '../support/support.js';
import { record } from '../support/workspace-server-fixture.js';

for (const mode of ['success', 'assertion-failure', 'timeout'] as const) {
  // @feature docs/engineering/testing/architecture.md#浏览器与诊断
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
    assert.throws(() => process.kill(stoppedServicePid, 0), { code: 'ESRCH' }, 'scope waits for the workspace service process');
  })));
}
