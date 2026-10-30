import { authorDesignFixture } from './design-fixture.js';
import { createConsumer } from './support/consumer.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { renderOwnerFixture } from './owner-fixture.js';
import { compileTrace } from "../src/domain/trace/index.js";
import { createFeatureAt, addFeaturePageAt, setFeaturePageAt } from "../src/app/index.js";
import { createUseCaseAt } from "../src/app/index.js";
import { decodeDesignReadme } from "../src/model/index.js";
import { readDesignPlanPaths } from "../src/base/sources/index.js";
import { leafOwnerSelection, assertSameLeafSelection } from "../src/domain/documents/index.js";
import { traceDigest } from "../src/base/publication/index.js";
import { templateBody } from "../src/domain/documents/index.js";

function write(root: string, path: string, source: string): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); }
function fixture(): string {
  const root = createConsumer();
  for (const path of ['docs/issues', 'memory', 'e2e']) mkdirSync(join(root, path), { recursive: true });
  write(root, 'memory/insight.md', renderOwnerFixture({ id: 'insight', title: 'Knowledge', kind: 'memory', type: 'insight', status: 'current', relations: [] }));
  write(root, 'docs/issues/issue.md', renderOwnerFixture({ id: 'issue', title: 'Issue', kind: 'issue', status: 'open', relations: [] }));
  write(root, 'docs/feature/migrated/README.md', renderOwnerFixture({ id: 'migrated', title: 'Feature', kind: 'feature' }));
  write(root, 'docs/feature/migrated/use-case/README.md', '# Use Cases\n');
  write(root, 'docs/feature/migrated/use-case/flow.md', renderOwnerFixture({ id: 'flow', title: 'Flow', kind: 'use-case', feature: 'docs/feature/migrated/README.md' }));
  write(root, 'docs/design/storage/README.md', renderOwnerFixture({ id: 'storage', title: 'Storage', kind: 'design', alternatives: ['files', 'sqlite'] }));
  for (const plan of ['files', 'sqlite']) write(root, `docs/design/storage/plans/${plan}/README.md`, `# ${plan}\n`);
  write(root, 'docs/design/storage/DECISION.md', '# Decision\n\n## Decision\n\nSelected: [files](plans/files/README.md)\n\n## Rationale\n\nFiles preserve the source.\n');
  authorDesignFixture(root, 'storage', ['files', 'sqlite'], 'files');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture']);
  return root;
}
const run = <A, E>(effect: Effect.Effect<A, E, import('effect').FileSystem.FileSystem>): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
test('advanced writing emits plain Spec pages and reads Design selection from DECISION', async () => {
  const root = fixture();
  try {
    const path = 'docs/design/storage/README.md';
    const decoded = decodeDesignReadme(path, readFileSync(join(root, path), 'utf8'), readDesignPlanPaths(root, 'docs/design/storage'), readFileSync(join(root, 'docs/design/storage/DECISION.md'), 'utf8'));
    assert.deepEqual(decoded.state, { _tag: 'decided', selectedPlan: 'docs/design/storage/plans/files/README.md' });
    const base = 'docs/_template/feature-design';
    write(root, `${base}/README.md`, templateBody('feature', '<功能或候选名>'));
    write(root, `${base}/use-case/README.md`, templateBody('use-case-index', '<功能或候选名>'));
    write(root, `${base}/library.md`, templateBody('library', '<功能或候选名>'));
    await run(createFeatureAt(root, { slug: 'written', title: 'Written', pages: ['use-case'], dryRun: false }));
    await run(createUseCaseAt(root, { slug: 'written-flow', parent: 'written', title: 'Written Flow', body: '# Written Flow\n', dryRun: false }));
    await run(addFeaturePageAt(root, { feature: 'written', page: 'library', dryRun: false }));
    const page = 'docs/feature/written/library.md';
    await run(setFeaturePageAt(root, { feature: 'written', page: 'library', body: '# Updated\n', expectedPreimageDigest: traceDigest(readFileSync(join(root, page), 'utf8')), dryRun: false }));
    assert.equal(readFileSync(join(root, 'docs/feature/written/README.md'), 'utf8').startsWith('---'), false);
    assert.equal(readFileSync(join(root, page), 'utf8'), '# Updated\n');
    assert.equal(readFileSync(join(root, 'docs/feature/written/use-case/written-flow.md'), 'utf8').startsWith('---'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
