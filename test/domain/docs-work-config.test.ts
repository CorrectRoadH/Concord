import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { setConfig, showConfig } from '../../src/app/index.ts';
import { ConcordError, type ProjectConfig } from '../../src/model/index.ts';
import { custom, fixture } from '../support/docs-work-fixture.ts';
import { LocalRepository } from '../support/repository.ts';

function withRepository<A>(root: string, run: (repository: LocalRepository) => A): A {
  const repository = new LocalRepository(root);
  try { return run(repository); } finally { repository.close(); }
}

// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
test('config set/show round-trip docsWork and reject malformed commands without changing the owner', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  try {
    const show = () => withRepository(root, showConfig);
    const current = show(); assert.deepEqual(current.config.docsWork, custom);
    const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    for (const docsWork of [{ checks: { invalid: { argv: [] } } }, { finalizer: { argv: [process.execPath], timeoutMs: 0 } }, { unsupported: true }]) {
      assert.throws(() => withRepository(root, repository => setConfig(repository, { ...current.config, docsWork } as unknown as ProjectConfig, current.digest)), error => error instanceof ConcordError && error.code === 'InvalidData');
      assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
    }
    const configured = { ...custom, sharedPaths: ['docs/README.md'], finalizer: { ...custom.finalizer, timeoutMs: 2000 } };
    const saved = withRepository(root, repository => setConfig(repository, { ...current.config, docsWork: configured } as unknown as ProjectConfig, current.digest));
    assert.equal(saved.operation, 'set-config');
    assert.deepEqual(saved.changedPaths, ['concord.config.ts']);
    const shown = show();
    assert.deepEqual(shown.config.docsWork, configured);
    assert.equal(shown.digest, saved.digest);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
