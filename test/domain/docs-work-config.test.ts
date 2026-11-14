import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { setConfig, showConfig } from '../../src/app/index.ts';
import { ConcordError, type ProjectConfig } from '../../src/model/index.ts';
import { custom, fixture } from '../support/docs-work-fixture.ts';
import { LocalRepository } from '../support/repository.ts';

async function withRepository<A>(root: string, run: (repository: LocalRepository) => A): Promise<A> {
  const repository = (await LocalRepository.open(root));
  try { return await run(repository); } finally { repository.close(); }
}

// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
test('config set/show round-trip shared paths and reject all external check configuration without changing the owner', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture(custom);
  try {
    const show = async () => (await withRepository(root, showConfig));
    const current = (await show()); assert.deepEqual(current.config.docsWork, custom);
    const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    for (const docsWork of [
      { checks: { writing: { argv: [process.execPath, '-e', 'process.exit(0)'] } } },
      { checks: {} },
      { finalizer: { argv: [process.execPath, '-e', 'process.exit(0)'], timeoutMs: 1000 } },
      { argv: [process.execPath] }, { timeoutMs: 1000 }, { unsupported: true },
    ]) {
      (await assert.rejects(async () => (await withRepository(root, async repository => (await setConfig(repository, { ...current.config, docsWork } as unknown as ProjectConfig, current.digest)))), error => error instanceof ConcordError && error.code === 'InvalidData'));
      assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
    }
    const configured = { sharedPaths: ['docs/README.md'] };
    const saved = (await withRepository(root, async repository => (await setConfig(repository, { ...current.config, docsWork: configured } as unknown as ProjectConfig, current.digest))));
    assert.equal(saved.operation, 'set-config');
    assert.deepEqual(saved.changedPaths, ['concord.config.ts']);
    const shown = (await show());
    assert.deepEqual(shown.config.docsWork, configured);
    assert.equal(shown.digest, saved.digest);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
