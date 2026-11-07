// 跨进程保证：外部程序——通过真实 gh 子进程的版本、能力和 HTTP framing 协议完成连接检查、action 与同步。
// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { showConfig } from '../../src/app/index.ts';
import { runCli } from '../support/cli.ts';
import { ghFixture, stopCliWorkspace } from '../support/cli-complex-fixture.ts';
import { createConsumer } from '../support/consumer.ts';
import { writeGhFixture } from '../support/gh-fixture.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/feature/feedback/cli.md
test('packed public CLI adds gh connection, checks scope, and executes shared feedback action offline', { skip: process.platform === 'win32' }, async () => {
  const { scratch, consumer, env } = (await ghFixture(createConsumer));
  try {
    const scenario = join(scratch, 'gh-scenario.json');
    writeFileSync(scenario, JSON.stringify({ list: [] }));
    writeGhFixture(join(scratch, 'bin'), scenario, join(scratch, 'gh-calls.ndjson'));
    const cli = async (...args: readonly string[]): Promise<unknown> => {
      const result = await runCli({ argv: ['--root', consumer, '--json', ...args], cwd: consumer, env, signal: AbortSignal.timeout(30_000) });
      assert.equal(result.exitCode, 0, JSON.stringify({ args, ...result }));
      return JSON.parse(result.stdout) as unknown;
    };
    await cli('feedback', 'connection', 'add', '--id', 'gh-packed', '--provider', 'github', '--transport', 'gh', '--owner', 'example', '--repo', 'product');
    assert.equal((await cli('feedback', 'connection', 'check', 'gh-packed') as { target: string }).target, 'example/product');
    const action = join(scratch, 'action.json');
    writeFileSync(action, JSON.stringify({ action: 'feedback.check', connection: 'gh-packed' }));
    assert.equal((await cli('action', '--input', action) as { transport: string }).transport, 'gh');
    assert.equal((await cli('feedback', 'sync', '--connection', 'gh-packed') as { fetched: number }).fetched, 0);
    const repo = (await LocalRepository.open(consumer));
    try { const connection = showConfig(repo).config.feedbackConnections?.[0]; assert.equal(connection?.provider === 'github' ? connection.repositoryId : undefined, '42'); }
    finally { repo.close(); }
  } finally { await stopCliWorkspace(consumer, env); rmSync(scratch, { recursive: true, force: true }); }
});
