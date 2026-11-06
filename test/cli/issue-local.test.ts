import { sourceCli } from '../support/source-consumer.ts';
import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import { decodeDocumentSource } from "../../src/domain/documents/index.ts";

const packedRoot = mkdtempSync(join(tmpdir(), 'concord-issue-packed-'));
let cli: string;
before(() => {
  cli = sourceCli();
});
after(() => rmSync(packedRoot, { recursive: true, force: true }));
function call(root: string, args: string[], status = 0): Record<string, unknown> {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim() || result.stderr) as Record<string, unknown>;
}
// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('local Issue links and deletion preserve inbound reference guards', t => {
  const root = createConsumer(); t.after(() => rmSync(root, { recursive: true, force: true }));
  call(root, ['new', 'memory', 'investigation', '--title', 'Investigation']);
  for (const id of ['canonical', 'observation']) call(root, ['new', 'issue', id]);
  const path = 'docs/issues/observation.md';
  call(root, ['issue', 'link', 'observation', 'memory/investigation.md']);
  call(root, ['issue', 'link', 'observation', 'memory/investigation.md'], 1);
  call(root, ['issue', 'link', 'canonical', path, '--role', 'related']);
  const refused = call(root, ['issue', 'close', 'observation', '--reason', 'Handled'], 1);
  assert.equal(refused.error, 'IssueReferenced');
  call(root, ['issue', 'unlink', 'canonical', path, '--role', 'related']);
  const closed = call(root, ['issue', 'close', 'observation', '--reason', 'Handled']);
  assert.match(String(closed.conclusion), /Closed docs\/issues\/observation.md/u);
  assert.throws(() => readFileSync(join(root, path)), /ENOENT/u);
});
