import { createConsumer } from '../support/consumer.ts';
import { writeProjectConfig } from '../support/support.ts';
import { parseWritingPolicy, renderWritingPolicy } from '../../src/model/index.ts';
import { initialize } from '../support/operations.ts';
import { LocalRepository as RepositoryBase } from '../../src/base/workspace/index.ts';
import { executeQuery } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { Effect } from 'effect';
import { executeViewAction } from "../../src/app/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { checkProject } from "../../src/app/index.ts";
import { checkCurrentProject } from "../../src/app/index.ts";
import { ConcordError } from "../../src/model/index.ts";


// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('project check combines relation and writing findings and reports incomplete writing inputs', async t => {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const withRepo = <T>(run: (repo: LocalRepository) => T): T => {
    const repo = new LocalRepository(root);
    try { return run(repo); } finally { repo.close(); }
  };
  const callCheck = async () => {
    const result = await runApplication(executeQuery(root, { name: 'check', input: {} }, 'off'));
    return { status: result.exitCode, output: result.value as unknown as ReturnType<typeof checkProject> };
  };
  assert.equal(withRepo(checkProject).ok, true);

  const page = join(root, 'docs/_template/README.md');
  writeFileSync(page, `${readFileSync(page, 'utf8')}\nForbidden phrase.\n`);
  const policy = join(root, 'docs/writing.md');
  const current = parseWritingPolicy(readFileSync(policy, 'utf8'));
  const terms = [...current.bannedTerms];
  terms.push({ term: 'Forbidden phrase', use: 'Allowed phrase', why: 'test rule' });
  writeFileSync(policy, renderWritingPolicy({ ...current, bannedTerms: terms }));
  const writingOnly = withRepo(checkProject);
  assert.equal(writingOnly.ok, false);
  assert.equal(writingOnly.complete, true);
  assert.deepEqual(writingOnly.checks, { relations: { ok: true, complete: true }, writing: { ok: false, complete: true } });
  assert(writingOnly.findings.some(finding => finding.category === 'writing' && finding.code === 'bannedTerm'));
  assert.equal((await callCheck()).status, 1);
  assert.deepEqual((await callCheck()).output.checks, writingOnly.checks);
  const action = await runApplication(executeViewAction(root, { action: 'check' })) as ReturnType<typeof checkProject>;
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
  const command = await callCheck();
  assert.equal(command.status, 1);
  assert.equal(command.output.complete, false);
  assert.equal(command.output.checks.writing.complete, false);
});

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('current check retries real observed edits, closes attempts and refuses persistent drift', async t => {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = RepositoryBase.prototype.read;
  const page = join(root, 'docs/architecture.md');
  let changes = 1; let changed = 0;
  const spy = mock.method(RepositoryBase.prototype, 'read', function(this: LocalRepository, path: string) {
    const source = original.call(this, path);
    if (this.root === root && path === 'docs/architecture.md' && changes > 0 && source !== undefined) {
      changes--; changed++; writeFileSync(page, `${source}\n`);
    }
    return source;
  });
  try {
    const result = await runApplication(checkCurrentProject(root, 'off'));
    assert.equal(result.ok, true);
    assert.equal(changed, 1);
    changes = 100;
    await assert.rejects(runApplication(checkCurrentProject(root, 'off')), /after 3 attempts/u);
  } finally { spy.mock.restore(); }
  const error = mock.method(RepositoryBase.prototype, 'verifySnapshot', () => { throw new ConcordError('UnsafePath', 'fixture unsafe path'); });
  try { await assert.rejects(runApplication(checkCurrentProject(root, 'off')), /fixture unsafe path/u); }
  finally { error.mock.restore(); }
  assert.equal((await runApplication(checkCurrentProject(root, 'off'))).ok, true);
});
