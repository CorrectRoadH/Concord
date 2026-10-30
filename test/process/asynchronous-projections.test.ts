import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, packageBin, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, packConcord, installConcord, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#inspect-associations
// @name steps-historical-projections
test('packed C7 persists no owner or remote bodies and hydrates byte-identical current output', async () => {
  const root = packedConsumer(false);
  try {
    const ownerPath = 'docs/feature/sample/README.md';
    writeFileSync(join(root, ownerPath), readFileSync(join(root, ownerPath), 'utf8') + '\nPRIVATE_OWNER_BODY_SENTINEL\n');
    writeFileSync(join(root, 'docs/constitution.md'), readFileSync(join(root, 'docs/constitution.md'), 'utf8') + '\nPRIVATE_CONSTITUTION_BODY_SENTINEL\n');
    const repo = new LocalRepository(root);
    try {
      createDocument(repo, 'issue', { id: 'remote', title: 'Remote', body: '# Remote\n\nPRIVATE_ISSUE_BODY_SENTINEL\n' });
      createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample', body: '1. First {#first}\n2. Unmarked\n' });
    } finally { repo.close(); }
    const flow = 'docs/feature/sample/use-case/flow.md';
    writeFileSync(join(root, 'test/steps.ts'), `// @use-case ${flow}#first\n`);
    writeFileSync(join(root, 'src/steps.ts'), `// @concord-file\n// @concord-implements ${flow}#first\nexport const flow = 1;\n`);
    const issuePath = join(root, 'docs/issues/remote.md');
    const source = readFileSync(issuePath, 'utf8');
    const issue = decodeDocumentSource('docs/issues/remote.md', source)!;
    assert(issue.metadata.kind === 'issue');
    writeFileSync(issuePath, renderDocument({ ...issue.metadata, source: { provider: 'github', instance: 'https://api.github.com', id: '123', url: 'https://github.com/example/example/issues/1', title: 'Remote', body: 'PRIVATE_REMOTE_BODY_SENTINEL', state: 'open', updatedAt: '2026-10-06T00:00:00.000Z', connectionId: 'github', importedAt: '2026-10-06T00:00:00.000Z' } }, issue.body));
    for (const query of [['trace', 'show', ownerPath], ['trace', 'show', 'docs/issues/remote.md'], ['review', 'render', 'sample']] as const) {
      const result = await refreshInstalled(root, query);
      assert.equal(result.status, 0, result.stderr);
      const context = { privateDir: genericPrivateDirectorySync(root), query };
      const stored = packedEnvelope(root, context.query);
      assert.ok(stored.record, JSON.stringify(stored));
      const db = openHawdb(cacheDatabasePath(context.privateDir), { readOnly: true, create: false });
      try { assert.doesNotMatch(JSON.stringify(db.scan('query_cache')), /PRIVATE_(OWNER|CONSTITUTION|ISSUE|REMOTE)_BODY_SENTINEL/u); } finally { db.close(); }
      const current = installedCall(root, '--json', '--fresh', '--dry-run', ...query);
      const historical = installedCall(root, '--json', ...query);
      assert.equal(current.status, 0, current.stderr);
      assert.equal(historical.status, 0, historical.stderr);
      assert.doesNotMatch(current.stdout + historical.stdout, /relationsUnknown|codeRelationsUnknown/u);
      const output = JSON.parse(historical.stdout);
      if (query[0] === 'trace' && query[2] === ownerPath) {
        assert.equal(output.stepGroups[0].steps[0].id, 'first');
        assert.equal(output.stepGroups[0].steps[0].testCount, 1);
        assert.equal(output.stepGroups[0].steps[0].codeCount, 1);
      }
      if (query[0] === 'review') assert.equal(output.body, JSON.parse(current.stdout));
      else {
        const { projection: _projection, cache: _cache, ...old } = output;
        const { cache: _freshCache, ...fresh } = JSON.parse(current.stdout);
        assert.equal(JSON.stringify(old), JSON.stringify(fresh));
      }
      await waitForRefreshExit(root);
    }
    assert.equal((await refreshInstalled(root, ['trace', 'gaps'])).status, 0);
    const gaps = installedCall(root, '--json', 'trace', 'gaps');
    assert.equal(gaps.status, 0, gaps.stderr);
    assert.equal(JSON.parse(gaps.stdout).unmarkedLists[0].path, flow);
    await waitForRefreshExit(root);
    writeFileSync(join(root, ownerPath), readFileSync(join(root, ownerPath), 'utf8') + '\nchanged\n');
    const changed = installedCall(root, '--json', 'trace', 'show', ownerPath);
    const changedValue = JSON.parse(changed.stdout);
    assert.deepEqual(changedValue.projection.bodyChanged, [ownerPath]);
    assert.equal(changedValue.subject.body, undefined);
    await waitForRefreshExit(root);
    writeFileSync(join(root, 'docs/constitution.md'), readFileSync(join(root, 'docs/constitution.md'), 'utf8') + '\nchanged\n');
    const review = JSON.parse(installedCall(root, '--json', 'review', 'render', 'sample').stdout);
    assert.deepEqual(review.projection.bodyChanged, ['docs/constitution.md']);
    assert.match(review.body, /constitution changed since projection/u);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
