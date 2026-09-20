import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { checkDesign, checkDocuments, createDocument, decideDesign, formatDesign, loadDocuments } from '../dist/documents.js';
import { formatDesignMarkdown } from '../dist/design-content.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { authorDesignFixture } from './design-fixture.js';
import { executeViewAction } from '../dist/application.js';

function consumer(run: (repo: LocalRepository, base: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'concord-design-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    createDocument(repo, 'design', { id: 'storage', title: 'Storage', alternatives: ['local', 'remote'] });
    authorDesignFixture(root, 'storage', ['local', 'remote'], 'local');
    run(repo, join(root, 'docs/design/storage'));
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Web structured actions use the same Design decision gate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-design-action-'));
  try {
    await Effect.runPromise(Effect.sync(() => {
      execFileSync('git', ['init', '-q', root]);
      const repo = new LocalRepository(root, { initialize: true });
      try { initialize(repo, false, { testRoots: [] }); createDocument(repo, 'design', { id: 'storage', title: 'Storage', alternatives: ['local', 'remote'] }); }
      finally { repo.close(); }
    }));
    const action = { action: 'design.decide', id: 'storage', selected: 'local', targets: [], reason: 'Offline storage' };
    await assert.rejects(Effect.runPromise(executeViewAction(root, action)), /DesignSelectionInvalid/u);
    authorDesignFixture(root, 'storage', ['local', 'remote'], 'local');
    const ownerPath = join(root, 'docs/design/storage/README.md'); const before = readFileSync(ownerPath, 'utf8');
    await Effect.runPromise(executeViewAction(root, { ...action, dryRun: true }));
    assert.equal(readFileSync(ownerPath, 'utf8'), before);
    await Effect.runPromise(executeViewAction(root, action));
    assert.match(readFileSync(ownerPath, 'utf8'), /selected: local/u);
  } finally { await Effect.runPromise(Effect.sync(() => rmSync(root, { recursive: true, force: true }))); }
});

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Design validates all candidates, selected constraints, explicit selection, and Goal gap explanations', () => Effect.runPromise(Effect.sync(() => consumer((repo, base) => {
  assert.equal(checkDesign(repo, 'storage').ok, true);
  assert.deepEqual(checkDesign(repo, 'storage').candidates.map(plan => plan.eligible), [true, false]);
  const planPath = join(base, 'plans/local/README.md');
  const original = readFileSync(planPath, 'utf8');
  const owner = readFileSync(join(base, 'README.md'), 'utf8');
  const cases: [string, string][] = [
    [original.replace('| satisfied | All data', '| pending | All data'), 'DesignLimitUnsatisfied'],
    [original.replace('LIMITS.md#l1-offline', 'LIMITS.md#wrong'), 'DesignRequirementReferenceInvalid'],
    [original.replace('| satisfied | All data', '| partial | All data'), 'DesignStatusInvalid'],
    [original.replace('All data stays on disk', 'TODO'), 'DesignResponseIncomplete'],
    [original.replace('## Limits', '### Limits'), 'DesignSectionInvalid'],
    [original.replace('## Limits', '## Limits\n\n## Limits'), 'DesignSectionInvalid'],
    [original.replace('| [L1]', '```md\n| [L1]') + '\n```\n', 'DesignTableInvalid'],
    [original.replace('| [L1](../../LIMITS.md#l1-offline)', '| [L2](../../LIMITS.md#l1-offline)'), 'DesignRequirementReferenceInvalid'],
    [original.replace('| satisfied | Index', '| partial | Index'), 'DesignGoalGapUnexplained'],
    [original.replace('Design analysis of the storage boundary; no execution claimed', '<!-- evidence -->'), 'DesignResponseIncomplete'],
  ];
  for (const [source, code] of cases) {
    writeFileSync(planPath, source);
    assert(checkDesign(repo, 'storage').findings.some(item => item.code === code), code);
    assert.throws(() => decideDesign(repo, 'storage', 'local', [], 'Reason', true), { code: 'DesignDecisionIncomplete' });
    assert.equal(readFileSync(join(base, 'README.md'), 'utf8'), owner);
  }
  writeFileSync(planPath, original.replace('| satisfied | Index', '| partial | Index'));
  const decisionPath = join(base, 'DECISION.md');
  const decision = readFileSync(decisionPath, 'utf8');
  writeFileSync(decisionPath, decision.replace('## Rationale\n', '## Rationale\n\nG1: Queries remain local, but latency needs measurement.\n'));
  assert.equal(checkDesign(repo, 'storage').ok, true);
  assert.throws(() => decideDesign(repo, 'storage', 'remote', [], 'Reason'), { code: 'DesignDecisionIncomplete' });
  const dry = decideDesign(repo, 'storage', 'local', [], 'Accepted latency gap', true);
  assert.equal(dry.dryRun, true);
  assert.equal(readFileSync(join(base, 'README.md'), 'utf8'), owner);
  const receipt = decideDesign(repo, 'storage', 'local', [], 'Accepted latency gap');
  assert(receipt.changedPaths.includes('docs/design/storage/plans/remote/README.md'), 'unselected candidate is guarded');
  assert.equal(checkDesign(repo, 'storage').ok, true);
  writeFileSync(decisionPath, decision.replaceAll('local', 'remote'));
  assert(checkDesign(repo, 'storage').findings.some(item => item.code === 'DesignSelectionConflict'));
  assert.deepEqual(checkDocuments(repo, loadDocuments(repo)), [], 'ordinary historical checks do not enforce new prose');
}))));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Design rejects duplicate or wrong-level requirements and incomplete unselected candidates', () => Effect.runPromise(Effect.sync(() => consumer((repo, base) => {
  const limitsPath = join(base, 'LIMITS.md'); const original = readFileSync(limitsPath, 'utf8');
  writeFileSync(limitsPath, original + '\n## L1: Another constraint\n\nA different condition.\n');
  assert(checkDesign(repo, 'storage').findings.some(item => item.code === 'DesignRequirementDuplicate'));
  writeFileSync(limitsPath, original.replace('## L1', '### L1'));
  assert(checkDesign(repo, 'storage').findings.some(item => item.code === 'DesignHeadingInvalid'));
  writeFileSync(limitsPath, original);
  const remote = join(base, 'plans/remote/README.md'); const source = readFileSync(remote, 'utf8');
  writeFileSync(remote, source.replace(/^\| \[G1\].*\n/mu, ''));
  assert.throws(() => decideDesign(repo, 'storage', 'local', [], 'Reason'), { code: 'DesignDecisionIncomplete' });
}))));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Design publication binds all validated bytes even for dry-run', () => Effect.runPromise(Effect.sync(() => {
  for (const dryRun of [true, false]) consumer((repo, base) => {
    const publish = repo.publish.bind(repo); const owner = readFileSync(join(base, 'README.md'), 'utf8');
    repo.publish = (operation, changes, dry) => {
      writeFileSync(join(base, 'plans/remote/README.md'), '# Concurrent edit\n');
      return publish(operation, changes, dry);
    };
    assert.throws(() => decideDesign(repo, 'storage', 'local', [], 'Reason', dryRun), { code: 'PreimageChanged' });
    assert.equal(readFileSync(join(base, 'README.md'), 'utf8'), owner);
    assert.equal(readFileSync(join(base, 'plans/remote/README.md'), 'utf8'), '# Concurrent edit\n');
  });
})));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Design formatter is idempotent, preserves code and semantic content, and supports dry-run', () => Effect.runPromise(Effect.sync(() => consumer((repo, base) => {
  assert.equal(formatDesignMarkdown('##   L1: \\*literal\\*  \n'), '## L1: \\*literal\\*\n');
  const file = join(base, 'plans/local/README.md'); const original = readFileSync(file, 'utf8');
  const source = original.replace('## Limits', '##   Limits  ').replace('| satisfied |', '|satisfied|') + '\n```md\n##   Example\n| a| b|c| d|\n```\n';
  writeFileSync(file, source);
  const expected = formatDesignMarkdown(source);
  assert.equal(formatDesignMarkdown(expected), expected);
  assert(expected.includes('```md\n##   Example\n| a| b|c| d|\n```'));
  formatDesign(repo, 'storage', true);
  assert.equal(readFileSync(file, 'utf8'), source);
  formatDesign(repo, 'storage');
  assert.equal(readFileSync(file, 'utf8'), expected);
  assert.equal(checkDesign(repo, 'storage').ok, true);
  assert.deepEqual(formatDesign(repo, 'storage').changedPaths, []);
}))));
