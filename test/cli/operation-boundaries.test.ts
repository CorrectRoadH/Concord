import { createDocument } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { runCli, type CliResult } from '../support/cli.ts';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from '../support/repository.ts';

async function withConsumerAsync(run: (root: string) => Promise<void>): Promise<void> {
  const root = createConsumer();
  try {
    await run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function withRepo(root: string, run: (repo: LocalRepository) => void, access: 'read' | 'write' = 'write'): void {
  const repo = new LocalRepository(root, { access });
  try { run(repo); } finally { repo.close(); }
}

function write(root: string, path: string, source: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
}

async function call(root: string, args: readonly string[], status: number, input = ''): Promise<CliResult> {
  const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: process.cwd(), env: process.env, stdin: input, signal: AbortSignal.timeout(20000) });
  assert.equal(result.exitCode, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  return result;
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('CLI and action preserve partial inventory diagnostics and healthy documents', () => runApplication(Effect.promise(() => withConsumerAsync(async root => {
    withRepo(root, repo => createDocument(repo, 'feature', { id: 'healthy', title: 'Healthy', pages: [] }));
    const bad = 'docs/feature/broken/README.md';
    write(root, bad, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    const command = JSON.parse((await call(root, ['check'], 1)).stdout) as { ok: boolean; complete?: boolean; documents: number; findings: { path: string; code: string }[] };
    assert.equal(command.ok, false);
    assert.ok(command.documents >= 1);
    assert.ok(command.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    const action = JSON.parse((await call(root, ['action', '--input', '-'], 0, JSON.stringify({ action: 'check' }))).stdout) as { ok: boolean; complete?: boolean; documents: number; findings: { path: string; code: string }[] };
    assert.equal(action.ok, false);
    assert.ok(action.documents >= 1);
    assert.ok(action.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    assert.deepEqual([command.complete, action.complete], [false, false], 'CLI and action checks must state that their inventories are incomplete');
  }))));
