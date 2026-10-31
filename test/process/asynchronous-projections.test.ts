import { assert, test, rmSync, refreshInstalled, packedEnvelope, installedCall, waitForRefreshExit } from '../support/asynchronous-projections-fixture.js';
import { queryFactsConsumer, ownerPath } from '../support/query-facts-fixture.js';

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C7 worker publishes a readable body-free envelope and exits', async () => {
  const root = queryFactsConsumer();
  try {
    const query = ['trace', 'show', ownerPath] as const;
    const result = await refreshInstalled(root, query);
    assert.equal(result.status, 0, result.stderr);
    const stored = packedEnvelope(root, query);
    assert.ok(stored.record, JSON.stringify(stored));
    assert.doesNotMatch(JSON.stringify(stored), /PRIVATE_(OWNER|CONSTITUTION|ISSUE|REMOTE)_BODY_SENTINEL/u);
    const historical = installedCall(root, '--json', ...query);
    assert.equal(historical.status, 0, historical.stderr);
    assert.match(historical.stdout, /PRIVATE_OWNER_BODY_SENTINEL/u);
    await waitForRefreshExit(root);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
