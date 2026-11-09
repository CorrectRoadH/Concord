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
test('workflow inspection observes differing copies, ownership and absence without writing', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root, { persistentCache: 'off' }));
  try {
    const generated = planWorkflowSkills(repo, '1.2.0').changes;
    const left = workflowSkillPaths[0]!, right = '.claude/skills/concord-spec/SKILL.md';
    const source = generated.find(change => change.path === left)!.after!;
    for (const change of generated) write(root, change.path, change.after!);
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
    assert.equal((await doctor(repo)).nextSteps.includes('Run concord skills install.'), true);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
test('obsolete managed deletion recovers prepared and committed journals and rejects unowned or other-operation deletions', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await createConsumer());
  const obsolete = '.agents/skills/concord-retired/SKILL.md';
  const planner = (await LocalRepository.open(root, { persistentCache: 'off' }));
  const before = planWorkflowSkills(planner, '0.1.0').changes[0]!.after!;
  planner.close();
  try {
    for (const phase of ['prepared', 'committed'] as const) {
      write(root, obsolete, before);
      const repo = (await LocalRepository.open(root, { persistentCache: 'off' }));
      const journal = { format: 'concord.journal', root, privateDir: repo.privateDir, operation: 'skills-install', phase, directories: [],
        scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
        changes: [{ path: obsolete, before, after: null, beforeDigest: digest(before), afterDigest: null, mode: 0o644 }],
      };
      repo.close();
      rmSync(join(root, obsolete));
      write(root, '.git/concord/journal.json', JSON.stringify(journal));
      const recovering = (await LocalRepository.open(root, { recover: true, persistentCache: 'off' }));
      try { (await recovering.recover()); } finally { recovering.close(); }
      assert.equal(existsSync(join(root, obsolete)), phase === 'prepared');
      if (phase === 'prepared') assert.equal(readFileSync(join(root, obsolete), 'utf8'), before);
      assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
    }
    for (const [operation, source] of [['skills-install', 'User owned.\n'], ['new', before]]) {
      write(root, obsolete, source!);
      const repo = (await LocalRepository.open(root, { persistentCache: 'off' }));
      try {
        (await assert.rejects(async () => (await repo.publish(operation!, [{ path: obsolete, before: source!, after: null }], false)), { code: 'InvalidChange' }));
        assert.equal(readFileSync(join(root, obsolete), 'utf8'), source);
        const journal = { format: 'concord.journal', root, privateDir: repo.privateDir, operation, phase: 'prepared', directories: [],
          scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
          changes: [{ path: obsolete, before: source, after: null, beforeDigest: digest(source!), afterDigest: null, mode: 0o644 }],
        };
        const text = JSON.stringify(journal);
        write(root, '.git/concord/journal.json', text);
        (await assert.rejects(async () => {
          const recovering = (await LocalRepository.open(root, { recover: true, persistentCache: 'off' }));
          try { (await recovering.recover()); } finally { recovering.close(); }
        }, { code: 'RecoveryConflict' }));
        assert.equal(readFileSync(join(root, '.git/concord/journal.json'), 'utf8'), text);
        assert.equal(readFileSync(join(root, obsolete), 'utf8'), source);
        rmSync(join(root, '.git/concord/journal.json'));
      } finally { repo.close(); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
