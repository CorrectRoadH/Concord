// 跨进程保证：服务与 IPC——真实 CLI 基准会话确认保存，父作用域停止两个私有服务后才删除仓库。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { Effect, Exit, Scope } from 'effect';
import { ModSession } from '../../src/entry/herdr-mod/index.ts';
import { documentBodies, featurePath, modRepositoryFixture } from '../../bench/support/herdr-mod.ts';

// @feature docs/feature/herdr-mod/README.md
test('benchmark consumers use real CLI sessions and release both private services', { timeout: 120_000 }, async () => {
  const scope = await Effect.runPromise(Scope.make());
  let directory: string | undefined;
  try {
    const fixture = await modRepositoryFixture(scope);
    directory = dirname(fixture.roots[0]);
    const sessions = fixture.roots.map(root => new ModSession(fixture.host, root));
    try {
      for (const session of sessions) {
        await Effect.runPromise(session.refresh());
        assert.ok(session.loaded && session.initialized);
        assert.ok(session.documents.some(document => document.path === featurePath));
        assert.ok(existsSync(`${session.root}/.git/concord/server/current.json`));
      }
      const session = sessions[0]!;
      const calls: string[][] = [];
      const observed = new ModSession({ exec: (command, args, options) => {
        calls.push(args);
        return fixture.host.exec(command, args, options);
      } }, session.root);
      try {
        await Effect.runPromise(observed.open(featurePath));
        assert.equal(observed.source, documentBodies[0]);
        for (const body of [documentBodies[1], documentBodies[0]]) {
          await Effect.runPromise(observed.save(body));
          assert.equal(observed.source, body);
          assert.equal(observed.saving, false);
          assert.equal(observed.draft, undefined);
        }
        assert.ok(calls.every(args => args[args.indexOf('--root') + 2] !== 'check'));
      } finally { observed.stop(); }
    } finally { for (const session of sessions) session.stop(); }
    // Outer-scope cleanup also covers generators whose sampling body throws before resuming.
  } finally { await Effect.runPromise(Scope.close(scope, Exit.void)); }
  assert.ok(directory);
  assert.equal(existsSync(directory), false, 'both server stops finish before private repositories are removed');
});
