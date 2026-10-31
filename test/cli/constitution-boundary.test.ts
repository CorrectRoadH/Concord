import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { digest } from '../../src/model/index.js';
import { LocalRepository } from '../support/repository.js';
import { createDocument } from '../support/operations.js';
import { createConsumer } from '../support/consumer.js';
import { installedConcordCli } from '../support/support.js';

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md
test('built constitution commands render references and preserve named amendment and link errors', () => {
  const root = createConsumer();
  const cli = installedConcordCli();
  const run = (args: string[], input?: string, status = 0) => {
    const output = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { input, encoding: 'utf8', timeout: 30_000 });
    assert.equal(output.status, status, `${output.stdout}\n${output.stderr}`);
    return JSON.parse(output.stdout || output.stderr) as unknown;
  };
  const body = '# Constitution\n\n## C-001 Keep source {#c-001}\n\n1. Preserve bytes. {#c-001-bytes}\n';
  const action = (kind: 'adopt' | 'amend', source: string, status = 0) => run(['action', '--input', '-'], JSON.stringify({ action: `constitution.${kind}`, body: source, reason: 'Keep source', impact: 'All files', sources: [], expectedDigest: digest(readFileSync(join(root, 'docs/constitution.md'), 'utf8')) }), status);
  try {
    action('adopt', body);
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); } finally { repo.close(); }
    appendFileSync(join(root, 'docs/feature/sample/README.md'), '\nUse [bytes](../../constitution.md#c-001-bytes).\n');
    const show = Schema.decodeUnknownSync(Schema.Struct({ complete: Schema.Boolean, references: Schema.Array(Schema.Struct({ path: Schema.String, clause: Schema.String, paragraph: Schema.NullOr(Schema.String) })) }))(run(['constitution', 'show']));
    assert.equal(show.complete, true);
    assert.deepEqual(show.references, [{ path: 'docs/feature/sample/README.md', clause: 'c-001', paragraph: 'c-001-bytes' }]);
    assert.equal(Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(action('amend', body.replace('c-001-bytes', 'c-001-source'), 1)).error, 'ConstitutionClauseReferenced');
    appendFileSync(join(root, 'docs/feature/sample/README.md'), '\nUse [missing](../../constitution.md?x#c-001).\n');
    const checked = Schema.decodeUnknownSync(Schema.Struct({ findings: Schema.Array(Schema.Struct({ code: Schema.String })) }))(run(['check'], undefined, 1));
    assert.ok(checked.findings.some(finding => finding.code === 'ConstitutionLinkInvalid'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
