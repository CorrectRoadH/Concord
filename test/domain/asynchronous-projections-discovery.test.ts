import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { executeQuery, type QueryRequest } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('current queries discover real sources without reading environment files or following excluded links', async t => {
  const root = createConsumer();
  try {
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], sourceRoots: ['src'], sourceIgnore: ['src/vendor', 'test/vendor'] });
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); }
    finally { repo.close(); }
    for (const base of ['src', 'test']) mkdirSync(join(root, base));
    writeFileSync(join(root, 'src/000.ts'), '// @concord-file\n// @concord-implements docs/feature/sample/README.md\nexport const first = 1;\n');
    writeFileSync(join(root, 'test/000.ts'), '// @feature docs/feature/sample/README.md\nexport const first = 1;\n');
    for (const base of ['src', 'test']) {
      mkdirSync(join(root, base, 'vendor'));
      writeFileSync(join(root, base, 'vendor/invalid.ts'), '// @feature docs/feature/absent/README.md\n');
      symlinkSync(root, join(root, base, 'vendor/cycle'));
      symlinkSync(join(root, 'missing-secret'), join(root, base, '.env'));
      writeFileSync(join(root, base, '.env.local'), '// @feature docs/feature/absent/README.md\n');
      mkdirSync(join(root, base, '.env.production'));
      symlinkSync(root, join(root, base, '.env.production/cycle'));
      mkdirSync(join(root, base, 'dist'));
      writeFileSync(join(root, base, 'dist/bundle.js'), '// @feature docs/feature/generated/README.md\n');
      symlinkSync(root, join(root, base, 'dist/cycle'));
    }
    const requests = [
      { name: 'trace.gaps', input: {} },
      { name: 'trace.check', input: {} },
      { name: 'test.list', input: {} },
      { name: 'code.list', input: {} },
    ] as const satisfies readonly QueryRequest[];
    for (const request of requests) await t.test(request.name, async () => {
      const result = await runApplication(executeQuery(root, request));
      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.doesNotMatch(JSON.stringify(result.value), /missing-secret|absent\/README|generated\/README|\.env/u);
    });
    await t.test('candidate source symlinks are rejected', async () => {
      symlinkSync(join(root, 'src/000.ts'), join(root, 'src/linked.ts'));
      await assert.rejects(runApplication(executeQuery(root, { name: 'trace.gaps', input: {} })), { code: 'UnsafePath' });
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
