import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { queryContext, scanQueryProcess, scanQueryValue, hydrateQueryValue, renderReview, type Query } from '../../src/app/index.js';
import { cacheDatabasePath, openHawdb } from '../../src/base/cache/index.js';
import { type QueryValue, TraceGapsValue } from '../../src/model/index.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { readQuery, storeQuery } from '../support/operations.js';
import { queryFactsConsumer, ownerPath, flow } from '../support/query-facts-fixture.js';

const current = (root: string, query: Query) => {
  const repo = new LocalRepository(root, { access: 'read', dryRun: true, persistentCache: 'off' });
  try { return repo.snapshot(() => scanQueryValue(repo, query).value); } finally { repo.close(); }
};
async function persist(root: string, query: Query) {
  const context = await runApplication(queryContext(root, query));
  const scanned = await runApplication(scanQueryProcess(root, JSON.stringify(query)));
  assert.equal(scanned.ok, true, JSON.stringify(scanned));
  assert.ok(scanned.ok);
  storeQuery(context, { kind: 'candidate', message: scanned });
  const stored = readQuery(context);
  assert.ok(stored.record, JSON.stringify(stored));
  const db = openHawdb(cacheDatabasePath(context.privateDir), { readOnly: true, create: false });
  try { assert.doesNotMatch(JSON.stringify(db.scan('query_cache')), /PRIVATE_(OWNER|CONSTITUTION|ISSUE|REMOTE)_BODY_SENTINEL/u); } finally { db.close(); }
  return stored.record.value;
}

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#inspect-associations
// @name steps-historical-projections
test('C7 persists no owner or remote bodies and hydrates byte-identical current output', async () => {
  const root = queryFactsConsumer();
  try {
    const stored = new Map<string, QueryValue>();
    for (const query of [['trace', 'show', ownerPath], ['trace', 'show', 'docs/issues/remote.md'], ['review', 'render', 'sample']] as const) {
      const value = await persist(root, query); stored.set(JSON.stringify(query), value);
      const fresh = current(root, query);
      const historical = hydrateQueryValue(root, value).value;
      assert.doesNotMatch(JSON.stringify(fresh) + JSON.stringify(historical), /relationsUnknown|codeRelationsUnknown/u);
      if (query[0] === 'trace') {
        assert.ok('subject' in historical && 'subject' in fresh);
        const output = historical;
        if (query[2] === ownerPath) {
          assert.equal(output.stepGroups[0]!.steps[0]!.id, 'first');
          assert.equal(output.stepGroups[0]!.steps[0]!.testCount, 1);
          assert.equal(output.stepGroups[0]!.steps[0]!.codeCount, 1);
        }
        const { cache: _cache, ...old } = output;
        const { cache: _freshCache, ...latest } = fresh;
        assert.equal(JSON.stringify(old), JSON.stringify(latest));
      } else {
        const output = Schema.decodeUnknownSync(Schema.Struct({ body: Schema.String }))(historical);
        const repo = new LocalRepository(root, { access: 'read', dryRun: true, persistentCache: 'off' });
        try { assert.equal(output.body, repo.snapshot(() => renderReview(repo, 'sample', 'off'))); } finally { repo.close(); }
      }
    }
    const gaps = Schema.decodeUnknownSync(TraceGapsValue)(hydrateQueryValue(root, await persist(root, ['trace', 'gaps'])).value);
    assert.equal(gaps.unmarkedLists[0]!.path, flow);
    writeFileSync(join(root, ownerPath), readFileSync(join(root, ownerPath), 'utf8') + '\nchanged\n');
    const changed = hydrateQueryValue(root, stored.get(JSON.stringify(['trace', 'show', ownerPath]))!);
    assert.deepEqual(changed.bodyChanged, [ownerPath]);
    assert.ok('subject' in changed.value);
    assert.equal('body' in changed.value.subject ? changed.value.subject.body : undefined, undefined);
    writeFileSync(join(root, 'docs/constitution.md'), readFileSync(join(root, 'docs/constitution.md'), 'utf8') + '\nchanged\n');
    const review = hydrateQueryValue(root, stored.get(JSON.stringify(['review', 'render', 'sample']))!);
    assert.deepEqual(review.bodyChanged, ['docs/constitution.md']);
    assert.match(Schema.decodeUnknownSync(Schema.Struct({ body: Schema.String }))(review.value).body, /constitution changed since projection/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
