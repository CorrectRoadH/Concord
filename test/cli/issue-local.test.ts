import { packageBin } from '../../scripts/package-location.js';
import { packConcord, installConcord } from '../support/installed-package.js';
import { createConsumer } from '../support/consumer.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import { decodeDocumentSource } from "../../src/domain/documents/index.js";

const packedRoot = mkdtempSync(join(tmpdir(), 'concord-issue-packed-'));
let cli: string;
before(() => {
  const install = join(packedRoot, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  installConcord(install, packConcord(packedRoot)); cli = packageBin(join(install, 'node_modules/concord-sdlc'));
});
after(() => rmSync(packedRoot, { recursive: true, force: true }));
function call(root: string, args: string[], status = 0): Record<string, unknown> {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim() || result.stderr) as Record<string, unknown>;
}
// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('local Issue links, closure kinds and reopen persist only current declarations', t => {
  const root = createConsumer(); t.after(() => rmSync(root, { recursive: true, force: true }));
  call(root, ['new', 'feature', 'flow', '--title', 'Flow']);
  call(root, ['new', 'memory', 'decision', '--title', 'Decision', '--type', 'decision']);
  call(root, ['memory', 'activate', 'decision', '--reason', 'Adopted']);
  for (const id of ['canonical', 'observation']) call(root, ['new', 'issue', id, '--title', id]);
  const path = 'docs/issues/observation.md', target = 'docs/feature/flow/README.md';
  call(root, ['issue', 'link', 'observation', target, '--role', 'adopts']);
  assert.equal(call(root, ['issue', 'close', 'observation', '--kind', 'invalid', '--evidence', 'Disproven'], 1).error, 'InvalidState');
  call(root, ['issue', 'unlink', 'observation', target, '--role', 'adopts']);
  for (const role of ['investigation', 'root-cause', 'decision']) call(root, ['issue', 'link', 'observation', 'memory/decision.md', '--role', role]);
  assert.equal(call(root, ['issue', 'link', 'observation', 'memory/decision.md'], 1).error, 'DuplicateLink');
  for (const flags of [
    ['--reason', 'Reviewed'], ['--kind', 'invalid', '--evidence', 'Disproven'],
    ['--kind', 'duplicate', '--canonical', 'docs/issues/canonical.md'],
    ['--kind', 'declined', '--memory', 'memory/decision.md'],
    ['--kind', 'external-fixed', '--dependency', 'library', '--version', '2', '--proof', 'Release'],
  ]) {
    call(root, ['issue', 'close', 'observation', ...flags]);
    assert.equal(call(root, ['issue', 'link', 'observation', target, '--role', 'adopts'], 1).error, 'InvalidIssueState');
    call(root, ['issue', 'reopen', 'observation', '--reason', 'More investigation']);
    const record = decodeDocumentSource(path, readFileSync(join(root, path), 'utf8'));
    assert.equal(record?.metadata.kind === 'issue' && record.metadata.closure, undefined);
    assert.equal(record?.metadata.kind === 'issue' && record.metadata.status, 'open');
  }
  call(root, ['issue', 'link', 'observation', target, '--role', 'adopts']);
  call(root, ['issue', 'close', 'observation', '--kind', 'delivered', '--memory', 'memory/decision.md', '--target', target, '--proof', 'Accepted']);
  assert.doesNotMatch(readFileSync(join(root, path), 'utf8'), /(?:history|epoch|adoptions|memoryRelations):/u);
});
