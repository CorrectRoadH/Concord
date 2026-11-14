import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkCurrentProject, traceShow } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('neutral static checks and trace derive relations without loading source modules', async () => {
  const root = (await createConsumer());
  try {
    const writer = (await LocalRepository.open(root));
    try { (await createDocument(writer, 'feature', { id: 'cart', title: 'Cart' })); } finally { writer.close(); }
    writeProjectConfig(root, { testRoots: ['spec'], sourceRoots: ['lib'] });
    mkdirSync(join(root, 'spec')); mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'spec/cart.test.ts'), '// @feature docs/feature/cart/README.md\nimport { writeFileSync } from "node:fs";\nwriteFileSync(new URL("../EXECUTED", import.meta.url), "loaded");\n');
    writeFileSync(join(root, 'lib/cart.ts'), '// @concord-file\n// @concord-implements docs/feature/cart/README.md\nexport const quantity = 1;\n');
    const repo = (await LocalRepository.open(root));
    try {
      const trace = (await traceShow(repo, 'cart', 'off'));
      assert.equal(trace.tests.length, 1);
      assert.deepEqual(trace.codeDeclarations.map(item => item.file), ['lib/cart.ts']);
      assert.equal('commandOutcome' in trace.tests[0]!, false, 'a declaration does not acquire an execution verdict');
    } finally { repo.close(); }
    const checked = await runApplication(checkCurrentProject(root, 'off'));
    assert.equal(checked.ok, true, JSON.stringify(checked.findings));
    assert.equal(existsSync(join(root, 'EXECUTED')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
