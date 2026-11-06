// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { runCli } from '../support/cli.ts';
import { ghFixture, stopCliWorkspace } from '../support/cli-complex-fixture.ts';
import { createConsumer } from '../support/consumer.ts';


// @feature docs/feature/feedback/cli.md
test('packed public CLI rejects a credential-env option for gh transport', { skip: process.platform === 'win32' }, async () => {
  const { scratch, consumer, env } = ghFixture(createConsumer);
  try {
    const invalid = await runCli({ argv: ['--root', consumer, '--json', 'feedback', 'connection', 'add', '--id', 'bad-gh', '--provider', 'github', '--transport', 'gh', '--credential-env', 'BAD', '--owner', 'acme', '--repo', 'widgets'], cwd: consumer, env, signal: AbortSignal.timeout(30_000) });
    assert.notEqual(invalid.exitCode, 0);
    assert.equal((JSON.parse(invalid.stderr.trim()) as { error: string }).error, 'InvalidOption');
  } finally { await stopCliWorkspace(consumer, env); rmSync(scratch, { recursive: true, force: true }); }
});
