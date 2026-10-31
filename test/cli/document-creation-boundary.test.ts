import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.js';
import { installedConcordCli } from '../support/support.js';

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('built creation combines repeated page flags and preserves the named occupied-owner error', () => {
  const root = createConsumer(), cli = installedConcordCli();
  try {
    const args = [cli, '--root', root, '--json', 'new', 'feature', 'selected', '--title', 'Selected', '--pages', 'cli,library', '--pages', 'use-case'];
    const created = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 });
    assert.equal(created.status, 0, created.stderr);
    const result = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ changedPaths: Schema.Array(Schema.String) })))(created.stdout);
    assert.deepEqual([...result.changedPaths].sort(), ['docs/feature/selected/README.md', 'docs/feature/selected/cli.md', 'docs/feature/selected/library.md', 'docs/feature/selected/use-case/README.md']);
    const duplicate = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 });
    assert.equal(duplicate.status, 1, duplicate.stdout);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(duplicate.stderr).error, 'DocumentExists');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
