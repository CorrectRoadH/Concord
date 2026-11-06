// 跨进程保证：网络——真实HTTP超时取消令连接关闭，fixture停止时回收未发请求的TCP连接及服务进程。
import { initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { pollUntil, waitForWorkspaceNotModified, fetchFresh } from '../support/support.ts';
import { startViewServer } from '../e2e/server.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('poll deadline aborts an in-flight HTTP request and preserves unexpected HTTP diagnostics', () => Effect.runPromise(Effect.tryPromise(async () => {
  let accepted!: () => void;
  const requested = new Promise<void>(resolve => { accepted = resolve; });
  let disconnected!: () => void;
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createServer((request, response) => {
    if (request.url === '/api/workspace') { response.writeHead(500); response.end('actual upstream failure'); return; }
    request.once('close', disconnected);
    accepted();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const pending = pollUntil(async signal => {
      await fetchFresh(base, { signal });
      return undefined;
    }, { description: 'blocked HTTP probe', timeoutMs: 1000 });
    const rejected = assert.rejects(pending, { _tag: 'PollTimeout', message: /blocked HTTP probe/ });
    await requested;
    await rejected;
    await closed;
    await assert.rejects(waitForWorkspaceNotModified(base), /HTTP 500: actual upstream failure/);
  } finally {
    const stopped = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
    await stopped;
  }
}).pipe(Effect.timeout(5000))));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('browser fixture shutdown drains a speculative socket that never sent an HTTP request', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-e2e-lifecycle-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });

  const socket = connect(server.port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    const disconnected = once(socket, 'close');
    await server.close();
    await disconnected;
    assert.equal((server.process.exitCode === null && server.process.signalCode === null), false);
    assert.equal(socket.destroyed, true);
    await server.close();
  } finally {
    socket.destroy();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}).pipe(Effect.timeout(10000))));
