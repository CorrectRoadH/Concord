import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { runCli } from '../support/cli.ts';
import { fixture, custom } from '../support/docs-work-fixture.ts';
import { plan, report, item } from '../support/docs-work-domain-fixture.ts';

// @feature docs/feature/neutral-project-governance/cli.md
test('docs work exposes named receipt, ownership and state failures with exit one', async () => {
  const root = fixture(custom);
  const rejected = async (args: readonly string[], code: string) => {
    const result = await runCli({ argv: ['--root', root, '--json', 'docs', 'work', ...args], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30_000) });
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(result.stderr).error, code);
  };
  try {
    const prepared = await plan(root, [item('a', ['docs/a/']), item('b', ['docs/b/'], { blockedBy: ['a'], read: ['docs/a/'] })], 'boundary');
    const a = await report(root, 'boundary', 'a');
    const b = await report(root, 'boundary', 'b');
    await rejected(['check', 'boundary', 'b', '--verify', b.receiptDigest!], 'DocsWorkDependencyUnverified');
    await rejected(['prepare', '--scope', 'docs/a', '--run-id', 'boundary'], 'DocsWorkRunExists');
    writeFileSync(join(prepared.statePath!, 'lock'), '');
    await rejected(['check', 'boundary', 'a', '--report'], 'DocsWorkBusy');
    rmSync(join(prepared.statePath!, 'lock'));
    writeFileSync(join(root, 'docs/a/new.md'), '# New\n');
    await rejected(['check', 'boundary', 'a', '--verify', a.receiptDigest!], 'DocsWorkReceiptMismatch');
    await plan(root, [item('read', ['docs/c/'], { read: ['docs/input.md'] })], 'read');
    const originalInput = readFileSync(join(root, 'docs/input.md'), 'utf8');
    writeFileSync(join(root, 'docs/input.md'), '# Changed\n');
    await rejected(['check', 'read', 'read', '--report'], 'DocsWorkReadChanged');
    writeFileSync(join(root, 'docs/input.md'), originalInput);
    const configPath = join(root, 'concord.config.ts'); const config = readFileSync(configPath, 'utf8');
    writeFileSync(configPath, config + '\n');
    await rejected(['check', 'read', 'read', '--report'], 'DocsWorkConfigChanged');
    writeFileSync(configPath, config);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
