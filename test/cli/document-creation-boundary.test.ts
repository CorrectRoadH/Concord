import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.js';
import { installedConcordCli } from '../support/support.js';

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('built creation combines repeated page flags and preserves the named occupied-owner error', () => {
  const root = createConsumer(), cli = installedConcordCli();
  try {
    for (const kind of ['feature', 'engineering', 'roadmap']) {
      const args = [cli, '--root', root, '--json', 'new', kind, 'selected', '--title', 'Selected', '--pages', 'cli,library,api,format,ui', '--pages', 'performance,architecture,data-model,use-case'];
      const created = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 });
      assert.equal(created.status, 0, created.stderr);
      const result = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ changedPaths: Schema.Array(Schema.String) })))(created.stdout);
      const base = `docs/${kind}/selected/`;
      assert.deepEqual([...result.changedPaths].sort(), ['README.md', 'cli.md', 'library.md', 'api.md', 'format.md', 'ui.md', 'performance.md', 'architecture.md', 'data-model.md', 'use-case/README.md'].map(page => base + page).sort());
      const duplicate = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 });
      assert.equal(duplicate.status, 1, duplicate.stdout);
      assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(duplicate.stderr).error, 'DocumentExists');
    }
    const before = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '-z']);
    for (const [kind, pages] of [['feature', 'scope'], ['engineering', 'api,api'], ['roadmap', 'concepts'], ['feature', 'writing'], ['roadmap', 'cli,'], ['design', 'cli'], ['issue', 'format'], ['memory', 'ui'], ['use-case', 'cli']] as const) {
      const reply = spawnSync(process.execPath, [cli, '--root', root, '--json', 'new', kind, 'invalid', '--pages', pages], { encoding: 'utf8', timeout: 20_000 });
      assert.equal(reply.status, 1, reply.stdout + reply.stderr);
      assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(reply.stderr).error, 'InvalidInput');
      assert.deepEqual(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '-z']), before, `${kind}: invalid pages changed files`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
