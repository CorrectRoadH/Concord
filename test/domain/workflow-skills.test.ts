import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { doctor } from '../../src/app/index.ts';
import { inspectWorkflowSkills, planWorkflowSkills } from '../../src/app/workflow-skills.ts';
import { digest, workflowSkillPaths } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';

const write = (root: string, path: string, source: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
};

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
test('workflow update result rows compare versions, copies, ownership and absence without writing', () => Effect.runPromise(Effect.sync(() => {
  const root = createConsumer();
  const repo = new LocalRepository(root, { persistentCache: 'off' });
  try {
    const generated = planWorkflowSkills(repo, '1.2.0').changes;
    const left = workflowSkillPaths[0]!, right = '.claude/skills/concord-spec/SKILL.md';
    const source = generated.find(change => change.path === left)!.after!;
    const cases = [
      { name: 'older differing', version: '1.1.0', changed: true, expected: [left, right] },
      { name: 'older same body', version: '1.1.0', expected: [] },
      { name: 'unversioned differing', version: undefined, changed: true, expected: [left, right] },
      { name: 'unversioned same body', version: undefined, expected: [] },
      { name: 'newer differing', version: '1.3.0', changed: true, expected: [] },
      { name: 'numeric minor', version: '1.10.0', changed: true, expected: [] },
      { name: 'older prerelease', version: '1.2.0-rc.1', changed: true, expected: [left, right] },
      { name: 'same version', version: '1.2.0', expected: [] },
    ];
    for (const row of cases) {
      for (const change of generated) write(root, change.path, change.after!);
      const changed = source.replace(' version=1.2.0', row.version === undefined ? '' : ` version=${row.version}`) + (row.changed ? '\nChanged body.\n' : '');
      write(root, left, changed); write(root, right, changed);
      assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories.flatMap(item => item.details.paths), row.expected, row.name);
      assert.equal(readFileSync(join(root, left), 'utf8'), changed, row.name);
      assert.deepEqual(planWorkflowSkills(repo, '1.2.0').updatedPaths, row.version === '1.2.0' && !row.changed ? [] : [left, right], row.name);
    }
    for (const change of generated) write(root, change.path, change.after!);
    write(root, left, source.replace('version=1.2.0', 'version=1.1.0'));
    assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories, []);
    write(root, left, `${source}\nDifferent copy.\n`);
    assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories.flatMap(item => item.details.paths), [left, right]);
    rmSync(join(root, left));
    assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories, []);
    const obsolete = '.agents/skills/concord-retired/SKILL.md';
    write(root, obsolete, source);
    assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories.flatMap(item => item.details.paths), [obsolete]);
    write(root, obsolete, 'User owned.\n');
    assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories, []);
    for (const path of workflowSkillPaths) rmSync(join(root, path), { force: true });
    assert.equal(inspectWorkflowSkills(repo, '1.2.0').installed, false);
    assert.deepEqual(inspectWorkflowSkills(repo, '1.2.0').advisories, []);
    assert.equal(doctor(repo).nextSteps.includes('Run concord skills install.'), true);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
test('obsolete managed deletion recovers prepared and committed journals and rejects unowned or other-operation deletions', () => Effect.runPromise(Effect.sync(() => {
  const root = createConsumer();
  const obsolete = '.agents/skills/concord-retired/SKILL.md';
  const planner = new LocalRepository(root, { persistentCache: 'off' });
  const before = planWorkflowSkills(planner, '0.1.0').changes[0]!.after!;
  planner.close();
  try {
    for (const phase of ['prepared', 'committed'] as const) {
      write(root, obsolete, before);
      const repo = new LocalRepository(root, { persistentCache: 'off' });
      const journal = { format: 'concord.journal', root, privateDir: repo.privateDir, operation: 'skills-install', phase, directories: [],
        scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
        changes: [{ path: obsolete, before, after: null, beforeDigest: digest(before), afterDigest: null, mode: 0o644 }],
      };
      repo.close();
      rmSync(join(root, obsolete));
      write(root, '.git/concord/journal.json', JSON.stringify(journal));
      const recovering = new LocalRepository(root, { recover: true, persistentCache: 'off' });
      try { recovering.recover(); } finally { recovering.close(); }
      assert.equal(existsSync(join(root, obsolete)), phase === 'prepared');
      if (phase === 'prepared') assert.equal(readFileSync(join(root, obsolete), 'utf8'), before);
      assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
    }
    for (const [operation, source] of [['skills-install', 'User owned.\n'], ['new', before]]) {
      write(root, obsolete, source!);
      const repo = new LocalRepository(root, { persistentCache: 'off' });
      try {
        assert.throws(() => repo.publish(operation!, [{ path: obsolete, before: source!, after: null }], false), { code: 'InvalidChange' });
        assert.equal(readFileSync(join(root, obsolete), 'utf8'), source);
        const journal = { format: 'concord.journal', root, privateDir: repo.privateDir, operation, phase: 'prepared', directories: [],
          scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
          changes: [{ path: obsolete, before: source, after: null, beforeDigest: digest(source!), afterDigest: null, mode: 0o644 }],
        };
        const text = JSON.stringify(journal);
        write(root, '.git/concord/journal.json', text);
        assert.throws(() => {
          const recovering = new LocalRepository(root, { recover: true, persistentCache: 'off' });
          try { recovering.recover(); } finally { recovering.close(); }
        }, { code: 'RecoveryConflict' });
        assert.equal(readFileSync(join(root, '.git/concord/journal.json'), 'utf8'), text);
        assert.equal(readFileSync(join(root, obsolete), 'utf8'), source);
        rmSync(join(root, '.git/concord/journal.json'));
      } finally { repo.close(); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
