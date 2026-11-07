import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';
import { digest } from '../../src/model/index.ts';

// @feature docs/feature/web-workbench/cli.md
test('file.get and segmented input-text share the document read and digest-protected save boundary', async () => {
  const root = await createConsumer();
  const invoke = (args: string[]) => runCli({ argv: ['--root', root, '--json', 'action', ...args], cwd: root, env: process.env });
  try {
    const path = 'docs/architecture.md';
    const read = await invoke(['--input-text', JSON.stringify({ action: 'file.get', path })]);
    assert.equal(read.exitCode, 0, read.stderr);
    const file = JSON.parse(read.stdout) as { path: string; body: string; digest: string };
    assert.equal(file.path, path); assert.equal(file.body, readFileSync(join(root, path), 'utf8')); assert.equal(file.digest, digest(file.body));
    const body = file.body + '\nSaved 中文🙂\n';
    const json = JSON.stringify({ action: 'document.set', path, body, expectedDigest: file.digest });
    const saved = await invoke(['--input-text', json.slice(0, 19), `--input-text=${json.slice(19)}`]);
    assert.equal(saved.exitCode, 0, saved.stderr);
    assert.equal(readFileSync(join(root, path), 'utf8'), body);
    const stale = await invoke(['--input-text', json]);
    assert.equal(stale.exitCode, 1); assert.equal(JSON.parse(stale.stderr).error, 'FileChangedSinceRead');
    assert.equal(readFileSync(join(root, path), 'utf8'), body);
    const invalid = await invoke(['--input-text', JSON.stringify({ action: 'file.get', path: '../outside.md' })]);
    assert.equal(invalid.exitCode, 1);
    for (const args of [[], ['--input', '-', '--input-text', '{}']]) {
      const result = await invoke(args);
      assert.equal(result.exitCode, 1); assert.equal(JSON.parse(result.stderr).error, 'InvalidInput');
    }
    const malformed = await invoke(['--input-text', '{']);
    assert.equal(malformed.exitCode, 1); assert.equal(JSON.parse(malformed.stderr).error, 'InvalidJson');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/cli.md#等待下一份结果
test('workspace wait rejects timeout values outside its positive seconds limit', async () => {
  for (const timeout of ['0', '-1', '121', '1.5']) {
    const result = await runCli({ argv: ['--json', 'workspace', 'wait', '--timeout', timeout], cwd: process.cwd(), env: process.env });
    assert.notEqual(result.exitCode, 0, timeout);
  }
});
