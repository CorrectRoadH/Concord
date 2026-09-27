import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { executeViewAction } from '../dist/application.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { checkProject } from '../dist/project-check.js';

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
