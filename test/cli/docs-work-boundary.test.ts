import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { installedConcordCli } from '../support/support.ts';
import { fixture, custom } from '../support/docs-work-fixture.ts';
import { plan, report, verify, finalize, item } from '../support/docs-work-domain-fixture.ts';

// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
test('docs work exposes named receipt, ownership and state failures with exit one', async () => {
  const root = fixture(custom);
  const cli = installedConcordCli();
  const rejected = (args: readonly string[], code: string) => {
    const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'docs', 'work', ...args], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(result.stderr).error, code);
  };
  try {
    const prepared = await plan(root, [item('a', ['docs/a/']), item('b', ['docs/b/'], { blockedBy: ['a'], read: ['docs/a/'] })], 'boundary');
    const a = await report(root, 'boundary', 'a');
    const b = await report(root, 'boundary', 'b');
    rejected(['check', 'boundary', 'b', '--verify', b.receiptDigest!], 'DocsWorkDependencyUnverified');
    rejected(['prepare', '--scope', 'docs/a', '--run-id', 'boundary'], 'DocsWorkRunExists');
    writeFileSync(join(prepared.statePath!, 'lock'), '');
    rejected(['check', 'boundary', 'a', '--report'], 'DocsWorkBusy');
    rmSync(join(prepared.statePath!, 'lock'));
    writeFileSync(join(root, 'docs/a/new.md'), '# New\n');
    rejected(['check', 'boundary', 'a', '--verify', a.receiptDigest!], 'DocsWorkReceiptMismatch');
    await plan(root, [item('read', ['docs/c/'], { read: ['docs/input.md'] })], 'read');
    const originalInput = readFileSync(join(root, 'docs/input.md'), 'utf8');
    writeFileSync(join(root, 'docs/input.md'), '# Changed\n');
    rejected(['check', 'read', 'read', '--report'], 'DocsWorkReadChanged');
    writeFileSync(join(root, 'docs/input.md'), originalInput);
    const configPath = join(root, 'concord.config.ts'); const config = readFileSync(configPath, 'utf8');
    writeFileSync(configPath, config + '\n');
    rejected(['check', 'read', 'read', '--report'], 'DocsWorkConfigChanged');
    writeFileSync(configPath, config);
    await plan(root, [item('done', ['docs/c/'])], 'final');
    const receipt = await report(root, 'final', 'done');
    await verify(root, 'final', 'done', receipt.receiptDigest!); await finalize(root, 'final');
    rejected(['finalize', 'final'], 'DocsWorkFinalized');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
