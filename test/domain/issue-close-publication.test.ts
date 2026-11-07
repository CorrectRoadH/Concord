import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { syncBuiltinMocks as syncBuiltinESMExports } from '../support/builtin-mocks.ts';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository } from '../support/repository.ts';
import { closeIssue } from '../../src/domain/issues/index.ts';
import { parseTestDeclarations } from '../../src/domain/tests/index.ts';
import { planIssueClose } from '../../src/app/issue-close.ts';
import { digest } from '../../src/model/index.ts';

const issue = 'docs/issues/one.md';
const file = 'test/order.ts';
const source = '// @issue docs/issues/one.md\r\n// @feature docs/feature/cart/README.md\r\n// @issue docs/issues/two.md\r\n// @name order\r\nconst example = "// @issue docs/issues/one.md";\r\n';
async function fixture(run: (root: string, repo: LocalRepository) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-issue-close-'));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'docs/issues'), { recursive: true });
  mkdirSync(join(root, 'docs/feature/cart'), { recursive: true });
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'concord.config.ts'), "export default { testRoots: ['test'] };\n");
  writeFileSync(join(root, issue), '# One\n');
  writeFileSync(join(root, 'docs/issues/two.md'), '# Two\n');
  writeFileSync(join(root, 'docs/feature/cart/README.md'), '# Cart\n');
  writeFileSync(join(root, file), source);
  const repo = (await LocalRepository.open(root));
  try { await run(root, repo); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}
async function interrupt(root: string, repo: LocalRepository) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { rename(from, to); if (String(to) === join(root, file)) throw new Error('Interrupted test publication'); };
  syncBuiltinESMExports();
  try { (await assert.rejects(async () => (await closeIssue(repo, issue, 'Handled')), { code: 'RecoveryRequired' })); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
}

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('Issue closure removes only real matching lines in one publication and preserves test identity and bytes', async () => (await fixture(async (root, repo) => {
  const before = (await parseTestDeclarations(file, source)).cases[0]!.id;
  const preview = (await closeIssue(repo, issue, 'Handled', true));
  assert.deepEqual(preview.changedPaths, [issue, file]);
  assert.equal(readFileSync(join(root, file), 'utf8'), source);
  (await closeIssue(repo, issue, 'Handled'));
  assert.equal(existsSync(join(root, issue)), false);
  const after = readFileSync(join(root, file), 'utf8');
  assert.equal(after, source.slice(source.indexOf('\n') + 1));
  assert.equal((await parseTestDeclarations(file, after)).cases[0]!.id, before);
})));

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('test source drift after planning refuses Issue closure without publishing', async () => (await fixture(async (root, repo) => {
  (await assert.rejects(async () => (await repo.snapshot(async () => {
    (await planIssueClose(repo, { issue }));
    writeFileSync(join(root, file), `${source}// External edit\n`);
    (await repo.publishIssueClose(issue));
  })), { code: 'FileChangedSinceRead' }));
  assert.equal(readFileSync(join(root, issue), 'utf8'), '# One\n');
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
})));

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#完整路径
test('interrupted Issue cleanup rolls back prepared images and accepts committed images on recovery', async () => {
  for (const phase of ['prepared', 'committed'] as const) (await fixture(async (root, repo) => {
    (await interrupt(root, repo));
    const path = join(repo.privateDir, 'journal.json');
    const journal = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...journal, phase }));
    repo.close();
    const recovering = (await LocalRepository.open(root, { recover: true }));
    try { assert.equal((await recovering.recover()).status, phase === 'prepared' ? 'rolled-back' : 'committed'); }
    finally { recovering.close(); }
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(join(root, issue)), phase === 'prepared');
    assert.equal(readFileSync(join(root, file), 'utf8'), phase === 'prepared' ? source : source.slice(source.indexOf('\n') + 1));
  }));
});

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#写入保护
test('Issue recovery rejects a forged source rewrite and retains the journal', async () => (await fixture(async (root, repo) => {
  (await interrupt(root, repo));
  const path = join(repo.privateDir, 'journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { changes: { path: string; after: string | null; afterDigest: string | null }[] };
  const change = journal.changes.find(change => change.path === file)!;
  change.after = `${change.after}throw new Error('forged');\n`; change.afterDigest = digest(change.after);
  writeFileSync(path, JSON.stringify(journal));
  repo.close();
  (await assert.rejects(async () => (await LocalRepository.open(root, { recover: true })), { code: 'RecoveryRequired' }));
  assert.equal(existsSync(path), true);
})));
