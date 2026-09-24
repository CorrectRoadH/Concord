import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import test, { mock } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { createDesignAt, checkDesignAt, decideDesignAt } from '../dist/repository/docs/design/domain.js';
import { templateBody } from '../dist/templates.js';
import { authorDesignFixture } from './design-fixture.js';

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('repository Design shares content gates, guards dry-run inputs, and retains the complete plan projection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-repository-design-'));
  const run = <A, E>(effect: Effect.Effect<A, E, import('effect').FileSystem.FileSystem>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
  try {
    await Effect.runPromise(Effect.sync(() => {
      execFileSync('git', ['init', '-q', root]);
      mkdirSync(join(root, 'e2e')); mkdirSync(join(root, 'memory')); mkdirSync(join(root, 'feedback'));
      mkdirSync(join(root, 'docs/design'), { recursive: true });
      write(root, 'concord.repository.json', JSON.stringify({ format: 'concord.repository/v2', suites: [{ id: 'suite', root: 'e2e' }], historyPath: 'test-history.ts', policy: 'concord.native-reliability/v1' }));
      const feature = 'docs/_template/feature-design'; const design = 'docs/_template/design-decision';
      const optional = { library: ['library.md'], cli: ['cli.md'], architecture: ['architecture.md'], lifecycle: ['lifecycle.md'], 'use-case': ['use-case/README.md'] };
      write(root, `${feature}/manifest.json`, JSON.stringify({ format: 'concord.templates/v1', applicableKinds: ['feature', 'roadmap', 'design-plan'], requiredFiles: ['README.md'], optionalFiles: optional }));
      write(root, `${feature}/README.md`, templateBody('feature', 'Example'));
      for (const [name, paths] of Object.entries(optional)) for (const path of paths) write(root, `${feature}/${path}`, templateBody(name === 'use-case' ? 'use-case-index' : name, 'Example'));
      write(root, `${design}/manifest.json`, JSON.stringify({ format: 'concord.templates/v1', applicableKinds: ['design'], requiredFiles: ['README.md', 'GOALS.md', 'LIMITS.md', 'DECISION.md'], optionalFiles: { cases: ['CASES.md'] } }));
      for (const [path, name] of [['README.md', 'design'], ['GOALS.md', 'goals'], ['LIMITS.md', 'limits'], ['DECISION.md', 'decision-record'], ['CASES.md', 'cases']] as const) write(root, `${design}/${path}`, templateBody(name, 'Example'));
      execFileSync('git', ['-C', root, 'add', '.']);
      execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture']);
    }));
    await run(createDesignAt(root, { slug: 'storage', title: 'Storage', plans: 2, cases: false, pages: [], dryRun: false }));
    assert.match(readFileSync(join(root, 'docs/design/storage/plans/plan-1/README.md'), 'utf8'), /## Limits/u);
    await assert.rejects(run(decideDesignAt(root, 'storage', 'plan-2', true)), /DesignDecisionIncomplete/u);
    authorDesignFixture(root, 'storage', ['plan-1', 'plan-2'], 'plan-2');
    fs.renameSync(join(root, 'docs/design/storage'), join(root, 'docs/design/中文决策'));
    const decisionPath = join(root, 'docs/design/中文决策/DECISION.md');
    writeFileSync(decisionPath, readFileSync(decisionPath, 'utf8').replace('query the local store', 'query the `local` store'));
    assert.equal((await run(checkDesignAt(root, 'storage'))).ok, true);
    const ownerPath = join(root, 'docs/design/中文决策/README.md'); const owner = readFileSync(ownerPath, 'utf8');
    const goalsPath = join(root, 'docs/design/中文决策/GOALS.md'); const goals = readFileSync(goalsPath, 'utf8');
    const originalRead = fs.readFileSync;
    let reads = 0; let driftAt = Number.POSITIVE_INFINITY;
    const spy = mock.method(fs, 'readFileSync', ((...args: Parameters<typeof readFileSync>) => {
      const result = originalRead(...args);
      if (String(args[0]) === goalsPath && ++reads === driftAt) writeFileSync(goalsPath, `${goals}\nConcurrent edit.\n`);
      return result;
    }) as typeof readFileSync);
    syncBuiltinESMExports();
    try {
      await run(decideDesignAt(root, 'storage', 'plan-2', true));
      assert(reads >= 3);
      driftAt = reads - 1; reads = 0;
      await assert.rejects(run(decideDesignAt(root, 'storage', 'plan-2', true)), /changed after validation/u);
      assert.equal(readFileSync(ownerPath, 'utf8'), owner);
    } finally { spy.mock.restore(); syncBuiltinESMExports(); writeFileSync(goalsPath, goals); }
    const selected = await run(decideDesignAt(root, 'storage', 'plan-2', false));
    assert.equal(selected.design.ref, 'docs/design/中文决策/README.md');
    assert.equal(selected.design.slug, 'storage');
    assert.deepEqual(selected.plans.map(plan => plan.selector), ['plan-1', 'plan-2']);
    const next = readFileSync(ownerPath, 'utf8');
    assert.match(next, /\[plan-1\]\(plans\/plan-1\/README.md\)/u);
    assert.match(next, /\[plan-2（已选择）\]/u);
    assert.match(next, /reason: The selected candidate/u);
    assert.match(next, /query the `local` store/u);
    assert.equal((await run(checkDesignAt(root, 'storage'))).ok, true);
  } finally { await Effect.runPromise(Effect.sync(() => rmSync(root, { recursive: true, force: true }))); }
});
