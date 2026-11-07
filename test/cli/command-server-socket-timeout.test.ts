import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { Socket } from 'node:net';
import test from 'node:test';
import { runCli } from '../support/cli.ts';
import { fixture, record, recordPath } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/command-server-socket-open-timeout.md
test('parallel command CLIs include stalled socket opens in their ten-second startup deadline', { timeout: 45_000 }, async t => {
  const roots = Array.from({ length: 3 }, () => fixture());
  const sockets: Socket[] = [];
  t.mock.method(Socket.prototype, 'connect', function(this: Socket) {
    sockets.push(this);
    return this;
  });
  try {
    const results = await Promise.all(roots.map(root => runCli({
      argv: ['--root', root, '--json', '--server', 'command', 'test', 'list'], cwd: root, env: process.env,
    })));
    assert.ok(sockets.length >= roots.length, 'each command attempted its own real client socket');
    for (const [index, result] of results.entries()) {
      assert.equal(result.exitCode, 1, result.stderr);
      const error = JSON.parse(result.stderr);
      assert.equal(error.error, 'WorkspaceServerUnavailable', result.stderr);
      assert.match(error.message, /handshake within ten seconds/u);
      if (existsSync(recordPath(roots[index]!))) {
        const running = record(roots[index]!);
        assert.throws(() => process.kill(running.pid, 0), { code: 'ESRCH' }, 'owned service exits before the command');
      }
    }
    assert.ok(sockets.every(socket => socket.destroyed));
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
