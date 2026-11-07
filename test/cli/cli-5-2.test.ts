import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('new use-case accepts Unicode arguments and prints the generated path', async () => {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: '角色目录', title: 'NPC' }); }
  finally { repo.close(); }
  const args = ['--root', root, '--json', 'new', 'use-case', '扩展NPC动作', '--feature', '角色目录', '--title', '扩展 NPC 动作'];
  const preview = await runCli({ argv: ['--dry-run', ...args], cwd: process.cwd(), env: process.env });
  assert.equal(preview.exitCode, 0, preview.stderr);
  const paths = Schema.fromJsonString(Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
  assert.deepEqual(Schema.decodeUnknownSync(paths)(preview.stdout).changedPaths, ['docs/feature/角色目录/use-case/扩展NPC动作.md']);
  assert.equal(existsSync(join(root, 'docs/feature/角色目录/use-case/扩展NPC动作.md')), false);
  const result = await runCli({ argv: args, cwd: process.cwd(), env: process.env });
  assert.equal(result.exitCode, 0, result.stderr);
  const output = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ operation: Schema.Literal('new'), changedPaths: Schema.Array(Schema.String) })))(result.stdout);
  assert.deepEqual(output.changedPaths, ['docs/feature/角色目录/use-case/扩展NPC动作.md']);
});
