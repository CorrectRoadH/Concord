import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { caseDiscriminator, deriveTestReference } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('test list and review present the supporting-page test reference', async () => {
  const root = (await createConsumer());
  writeProjectConfig(root, { testRoots: ['test', 'tests'] });
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'accounts', title: 'Accounts', pages: ['cli'] })); }
  finally { repo.close(); }
  writeFileSync(join(root, 'docs/feature/accounts/cli.md'), '# Accounts CLI\n\n## Sign in\n\nReject expired tokens.\n');
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test/accounts.test.mjs'), "import test from 'node:test';\n// @feature docs/feature/accounts/cli.md#sign-in\ntest('rejects expired tokens', () => {});\n");
  const accountCase = deriveTestReference('test/accounts.test.mjs', 'test/accounts.test.mjs', caseDiscriminator('docs/feature/accounts/cli.md#sign-in', 0));
  const human = await runCli({ argv: ['--root', root, 'test', 'list'], cwd: process.cwd(), env: process.env });
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, new RegExp(accountCase));
  assert.match(human.stdout, /Contract:/);
  assert.ok(!human.stdout.trimStart().startsWith('{'));
  const review = await runCli({ argv: ['--root', root, '--json', '--fresh', 'review', 'accounts'], cwd: process.cwd(), env: process.env });
  assert.equal(review.exitCode, 0, review.stderr);
  assert.match(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.String))(review.stdout), new RegExp(accountCase));
});
