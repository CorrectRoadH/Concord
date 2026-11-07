import '../support/source-consumer.ts';
import { runCli } from '../support/cli.ts';
import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { decodeDocumentSource } from "../../src/domain/documents/index.ts";

const packedRoot = mkdtempSync(join(tmpdir(), 'concord-issue-packed-'));
after(() => rmSync(packedRoot, { recursive: true, force: true }));
async function call(root: string, args: string[], status = 0): Promise<Record<string, unknown>> {
  const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: root, env: process.env, signal: AbortSignal.timeout(30000) });
  assert.equal(result.exitCode, status, JSON.stringify({ args, status: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim() || result.stderr) as Record<string, unknown>;
}
// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('local Issue links and deletion preserve inbound reference guards', async t => {
  const root = (await createConsumer()); t.after(() => rmSync(root, { recursive: true, force: true }));
  await call(root, ['new', 'memory', 'investigation', '--title', 'Investigation']);
  for (const id of ['canonical', 'observation']) await call(root, ['new', 'issue', id]);
  const path = 'docs/issues/observation.md';
  await call(root, ['new', 'feature', 'target']);
  await call(root, ['issue', 'link', 'observation', 'docs/feature/target/README.md', '--role', 'spec']);
  assert.match(readFileSync(join(root, path), 'utf8'), /role: spec/u);
  const invalidRole = await runCli({ argv: ['--root', root, '--json', 'issue', 'link', 'observation', 'docs/feature/target/README.md', '--role', 'adopts'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30000) });
  assert.notEqual(invalidRole.exitCode, 0);
  assert.match(invalidRole.stdout + invalidRole.stderr, /spec/u);
  await call(root, ['issue', 'unlink', 'observation', 'docs/feature/target/README.md', '--role', 'spec']);
  await call(root, ['issue', 'link', 'observation', 'memory/investigation.md']);
  await call(root, ['issue', 'link', 'observation', 'memory/investigation.md'], 1);
  await call(root, ['issue', 'link', 'canonical', path, '--role', 'related']);
  const refused = await call(root, ['issue', 'close', 'observation', '--reason', 'Handled'], 1);
  assert.equal(refused.error, 'IssueReferenced');
  await call(root, ['issue', 'unlink', 'canonical', path, '--role', 'related']);
  const closed = await call(root, ['issue', 'close', 'observation', '--reason', 'Handled']);
  assert.match(String(closed.conclusion), /Closed docs\/issues\/observation.md/u);
  assert.throws(() => readFileSync(join(root, path)), /ENOENT/u);
});
