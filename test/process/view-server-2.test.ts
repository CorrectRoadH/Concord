import { Publication } from '../../src/base/publication/index.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { openWriteRepository } from '../../src/base/workspace/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { caseDiscriminator, deriveTestReference } from "../../src/model/index.ts";
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';

import { LocalRepository } from "../support/repository.ts";

import { ViewJobManager } from "../../src/app/index.ts";
import { formatViewAddress } from "../../src/entry/http/index.ts";
import { startViewServer, type ViewServerHandle } from '../e2e/server.ts';
import { parseWorkspaceProjection, pollUntil, installedConcordCli } from '../support/support.ts';
import { type WorkspaceProjection } from "../../src/model/index.ts";

import { fixture, send, sendRaw, parsed, jsonHeaders, waitForWorkspace } from '../support/view-http-fixture.ts';

async function waitFor(manager: ViewJobManager, id: string, state: readonly string[], timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = manager.list().find((item) => item.id === id);
    if (job !== undefined && state.includes(job.state)) return job;
    if (Date.now() >= deadline) throw new Error(`job ${id} did not reach ${state.join('/')}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const viewJobCase = deriveTestReference('test/view-case.test.js', 'test/view-case.test.js', caseDiscriminator('docs/feature/web/README.md', 0));

function writeCase(root: string, slow: boolean): void {
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/view-case.test.js'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\n// @feature docs/feature/web/README.md\ntest('view job case', async () => { ${slow ? "await new Promise(resolve => setTimeout(resolve, 10000));" : 'assert.equal(1, 1);'} });\n`);
}

function initializedJobFixture(): string {
  const { root } = fixture();
  let repo = new LocalRepository(root, { initialize: true });
  initialize(repo, false, { testRoots: ['test'], runner: { kind: 'command', argv: [process.execPath, '--test', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
  repo.close();
  repo = new LocalRepository(root);
  createDocument(repo, 'feature', { id: 'web', title: 'Web' });
  repo.close();
  writeCase(root, false);
  return root;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('HTTP jobs run, cancel, and run again without credentials', async () => {
  const root = initializedJobFixture();
  let server: ViewServerHandle | undefined;
  try {
    writeCase(root, true);
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const current = server;
    const start = async () => {
      const response = await send(current, '/api/jobs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ caseId: viewJobCase }) });
      assert.equal(response.status, 202, response.body);
      return (parsed(response).value as { id: string }).id;
    };
    const waitForHttp = async (id: string, states: readonly string[]) => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const response = await send(current, '/api/jobs');
        assert.equal(response.status, 200, response.body);
        const job = (parsed(response).value as { id: string; state: string; evidence?: { commandOutcome: string } }[]).find(item => item.id === id);
        if (job && states.includes(job.state)) return job;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`HTTP job ${id} did not reach ${states.join('/')}`);
    };
    const first = await start();
    await waitForHttp(first, ['running']);
    const cancelled = await send(current, `/api/jobs/${first}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 200, cancelled.body);
    await waitForHttp(first, ['cancelled']);
    writeCase(root, false);
    const second = await start();
    const completed = await waitForHttp(second, ['completed', 'failed']);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.evidence?.commandOutcome, 'pass', JSON.stringify(completed));
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('view jobs preserve pre-spawn cancellation, serialize repository ownership, and clean shutdown', async () => {
  const root = initializedJobFixture();
  let held: LocalRepository | undefined;
  try {
    const manager = new ViewJobManager(root, () => {}, (selected, use) => runApplication(Effect.scoped(Effect.gen(function*() {
      const sources = yield* Sources;
      const publication = yield* Publication;
      const repo = yield* openWriteRepository(selected);
      return yield* Effect.tryPromise({ try: () => use(repo, sources, publication), catch: cause => cause });
    }))));
    const beforeSpawn = manager.start(viewJobCase);
    assert.equal(manager.cancel(beforeSpawn.id).state, 'cancelling');
    assert.equal((await waitFor(manager, beforeSpawn.id, ['cancelled'])).state, 'cancelled');

    const completed = manager.start(viewJobCase);
    const completedResult = await waitFor(manager, completed.id, ['completed', 'failed']);
    assert.equal(completedResult.state, 'completed', JSON.stringify(completedResult.error));
    assert.equal(completedResult.evidence?.commandOutcome, 'pass', JSON.stringify(completedResult));

    held = new LocalRepository(root);
    held.beginSnapshot();
    const blocked = manager.start(viewJobCase);
    const blockedResult = await waitFor(manager, blocked.id, ['failed']);
    assert.equal(blockedResult.error?.code, 'RepositoryBusy');
    held.close();
    held = undefined;

    writeCase(root, true);
    const running = manager.start(viewJobCase);
    await waitFor(manager, running.id, ['running']);
    manager.cancel(running.id);
    assert.equal((await waitFor(manager, running.id, ['cancelled', 'cleanup-failed'])).state, 'cancelled');

    writeCase(root, false);
    const afterCancel = manager.start(viewJobCase);
    assert.equal((await waitFor(manager, afterCancel.id, ['completed', 'failed'])).state, 'completed');

    writeCase(root, true);
    const shutdown = manager.start(viewJobCase);
    await waitFor(manager, shutdown.id, ['running']);
    await manager.close();
    assert.equal((await waitFor(manager, shutdown.id, ['cancelled'])).state, 'cancelled');
    const unlocked = new LocalRepository(root);
    unlocked.close();
    assert.equal(readFileSync(join(root, 'test/view-case.test.js'), 'utf8').includes('10000'), true);
  } finally {
    held?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
