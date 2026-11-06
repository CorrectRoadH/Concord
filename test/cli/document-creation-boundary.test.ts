import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('built creation combines repeated page flags and preserves the named occupied-owner error', async () => {
  const root = createConsumer();
  try {
    for (const kind of ['feature', 'engineering', 'roadmap']) {
      const args = ['--root', root, '--json', 'new', kind, 'selected', '--title', 'Selected', '--pages', 'cli,library,api,format,ui', '--pages', 'performance,architecture,data-model,use-case'];
      const created = await runCli({ argv: args, cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(20_000) });
      assert.equal(created.exitCode, 0, created.stderr);
      const result = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ changedPaths: Schema.Array(Schema.String) })))(created.stdout);
      const base = `docs/${kind}/selected/`;
      assert.deepEqual([...result.changedPaths].sort(), ['README.md', 'cli.md', 'library.md', 'api.md', 'format.md', 'ui.md', 'performance.md', 'architecture.md', 'data-model.md', 'use-case/README.md'].map(page => base + page).sort());
      const duplicate = await runCli({ argv: args, cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(20_000) });
      assert.equal(duplicate.exitCode, 1, duplicate.stdout);
      assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(duplicate.stderr).error, 'DocumentExists');
    }
    const before = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '-z']);
    for (const [kind, pages] of [['feature', 'scope'], ['engineering', 'api,api'], ['roadmap', 'concepts'], ['feature', 'writing'], ['roadmap', 'cli,'], ['design', 'cli'], ['issue', 'format'], ['memory', 'ui'], ['use-case', 'cli']] as const) {
      const reply = await runCli({ argv: ['--root', root, '--json', 'new', kind, 'invalid', '--pages', pages], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(20_000) });
      assert.equal(reply.exitCode, 1, reply.stdout + reply.stderr);
      assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(reply.stderr).error, 'InvalidInput');
      assert.deepEqual(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '-z']), before, `${kind}: invalid pages changed files`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
