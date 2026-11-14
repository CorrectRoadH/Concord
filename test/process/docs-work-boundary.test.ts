// Cross-process contract: a finalized run remains finalized in another CLI process.
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { runCli } from '../support/cli.ts';
import { plan, report, verify, finalize, item, initializedFixture } from '../support/docs-work-domain-fixture.ts';

// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
test('docs work preserves finalized rejection after built-in static checks complete', async () => {
  const root = await initializedFixture();
  try {
    const prepared = await plan(root, [item('done', ['docs/a/'])], 'final');
    const receipt = await report(root, 'final', 'done');
    await verify(root, 'final', 'done', receipt.receiptDigest!); await finalize(root, 'final');
    const finalized = readFileSync(join(prepared.statePath!, 'finalize.json'), 'utf8');
    const result = await runCli({ argv: ['--root', root, '--json', 'docs', 'work', 'finalize', 'final'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30_000) });
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(result.stderr).error, 'DocsWorkFinalized');
    assert.equal(readFileSync(join(prepared.statePath!, 'finalize.json'), 'utf8'), finalized);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
