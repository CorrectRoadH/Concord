import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name packed-operation-boundaries
test('marker commands print JSON snippets and map malformed targets to a named failure', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try {
    for (const id of ['target', 'broken']) (await createDocument(repo, 'feature', { id, title: id }));
  } finally { repo.close(); }
  writeFileSync(join(root, 'docs/feature/broken/README.md'), '---\nformat: concord.document/v1\nkind: feature\n---\n# Incomplete owner\n');
  for (const [args, expected] of [
    [['code', 'marker', '--scope', 'file'], '// @concord-file\n// @concord-implements docs/feature/target/README.md\n'],
    [['test', 'marker'], '// @feature docs/feature/target/README.md\n'],
  ] as const) {
    const result = await runCli({ argv: ['--root', root, '--json', ...args, '--contract', 'docs/feature/target/README.md'], cwd: process.cwd(), env: process.env });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ snippet: Schema.String })))(result.stdout).snippet, expected);
  }
  const invalid = await runCli({ argv: ['--root', root, '--json', 'code', 'marker', '--scope', 'file', '--contract', 'docs/feature/broken/README.md'], cwd: process.cwd(), env: process.env });
  assert.equal(invalid.exitCode, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(invalid.stderr).error, 'InvalidData');
});
