import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('check rejects paths with the equivalent docs check command', async () => {
  const result = await runCli({ argv: ['--json', 'check', 'docs/design', 'docs/x.md'], cwd: process.cwd(), env: process.env });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr + result.stdout, /InvalidInput/);
  assert.match(result.stderr + result.stdout, /concord docs check docs\/design docs\/x.md/);
  assert.match(result.stderr + result.stdout, /writing and terminology/);
});

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('docs check accepts multiple positional files and directories and reports selection', async () => {
  const cwd = await createConsumer();
  try {
    mkdirSync(join(cwd, 'docs/selected'));
    writeFileSync(join(cwd, 'docs/selected/page.md'), '# Selected\n');
    writeFileSync(join(cwd, 'docs/image.svg'), '<svg><text>Selected</text></svg>');
    const argv = ['--dry-run', 'docs', 'check', 'docs/selected', 'docs/image.svg'];
    const result = await runCli({ argv: ['--json', ...argv], cwd, env: process.env });
    assert.equal(result.exitCode, 0, result.stderr + result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).selection, ['docs/image.svg', 'docs/selected']);
    const human = await runCli({ argv, cwd, env: process.env });
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /Mode: project; selection: docs\/image.svg, docs\/selected/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
