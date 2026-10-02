import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { Effect } from 'effect';
import { executeViewAction } from '../dist/application.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { checkProject } from '../dist/project-check.js';
import { checkCurrentProject } from '../dist/check-current.js';
import { ConcordError } from '../dist/shared.js';

const cli = new URL('../dist/entry.js', import.meta.url).pathname;

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('project check combines relation and writing findings and reports incomplete writing inputs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'concord-project-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const withRepo = <T>(run: (repo: LocalRepository) => T): T => {
    const repo = new LocalRepository(root);
    try { return run(repo); } finally { repo.close(); }
  };
  const callCheck = () => {
    const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'check'], { encoding: 'utf8' });
    return { status: result.status, output: JSON.parse(result.stdout) as ReturnType<typeof checkProject> };
  };
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { testRoots: [] }); } finally { initial.close(); }
  assert.equal(withRepo(checkProject).ok, true);

  const page = join(root, 'docs/_template/README.md');
  writeFileSync(page, `${readFileSync(page, 'utf8')}\nForbidden phrase.\n`);
  const policy = join(root, 'docs/concord-writing.json');
  const current = JSON.parse(readFileSync(policy, 'utf8')) as { bannedTerms: unknown[] };
  current.bannedTerms.push({ term: 'Forbidden phrase', use: 'Allowed phrase', why: 'test rule' });
  writeFileSync(policy, `${JSON.stringify(current)}\n`);
  const writingOnly = withRepo(checkProject);
  assert.equal(writingOnly.ok, false);
  assert.equal(writingOnly.complete, true);
  assert.deepEqual(writingOnly.checks, { relations: { ok: true, complete: true }, writing: { ok: false, complete: true } });
  assert(writingOnly.findings.some(finding => finding.category === 'writing' && finding.code === 'bannedTerm'));
  assert.equal(callCheck().status, 1);
  assert.deepEqual(callCheck().output.checks, writingOnly.checks);
  const action = await Effect.runPromise(executeViewAction(root, { action: 'check' })) as ReturnType<typeof checkProject>;
  assert.deepEqual(action.checks, writingOnly.checks);
  assert.deepEqual(action.findings, writingOnly.findings);

  writeFileSync(join(root, 'docs/feature/README.md'), '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
  const both = withRepo(checkProject);
  assert.equal(both.ok, false);
  assert.equal(both.checks.relations.ok, false);
  assert(both.findings.some(finding => finding.category === 'relation'));
  assert(both.findings.some(finding => finding.category === 'writing'));

  writeFileSync(policy, '{bad json\n');
  const incomplete = withRepo(checkProject);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.checks.writing.complete, false);
  assert(incomplete.findings.some(finding => finding.category === 'writing' && finding.code === 'InvalidWritingPolicy'));
  const command = callCheck();
  assert.equal(command.status, 1);
  assert.equal(command.output.complete, false);
  assert.equal(command.output.checks.writing.complete, false);
});

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('current check retries real observed edits, closes attempts and refuses persistent drift', async t => {
  const root = mkdtempSync(join(tmpdir(), 'concord-check-retry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const setup = new LocalRepository(root, { initialize: true });
  try { initialize(setup, false, { testRoots: [] }); } finally { setup.close(); }
  const original = LocalRepository.prototype.read;
  const page = join(root, 'docs/architecture.md');
  let changes = 1; let changed = 0;
  const spy = mock.method(LocalRepository.prototype, 'read', function(this: LocalRepository, path: string) {
    const source = original.call(this, path);
    if (this.root === root && path === 'docs/architecture.md' && changes > 0 && source !== undefined) {
      changes--; changed++; writeFileSync(page, `${source}\n`);
    }
    return source;
  });
  try {
    const result = await Effect.runPromise(checkCurrentProject(root, 'off'));
    assert.equal(result.ok, true);
    assert.equal(changed, 1);
    changes = 100;
    await assert.rejects(Effect.runPromise(checkCurrentProject(root, 'off')), /after 3 attempts/u);
  } finally { spy.mock.restore(); }
  const error = mock.method(LocalRepository.prototype, 'verifySnapshot', () => { throw new ConcordError('UnsafePath', 'fixture unsafe path'); });
  try { await assert.rejects(Effect.runPromise(checkCurrentProject(root, 'off')), /fixture unsafe path/u); }
  finally { error.mock.restore(); }
  assert.equal((await Effect.runPromise(checkCurrentProject(root, 'off'))).ok, true);
});
