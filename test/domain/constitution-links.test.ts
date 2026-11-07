import { createDocument } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from "../support/repository.ts";

import { checkProject } from "../../src/app/index.ts";

// @use-case docs/feature/taste/use-case/cite-taste.md
test('check reports a body link to a missing taste clause with its path and line', async () => {
  const root = (await createConsumer()); const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'feature', { id: 'cart', title: 'Cart' }));
    const path = 'docs/feature/cart/README.md';
    appendFileSync(join(root, path), '\n见 [T-99](../../taste.md#t-99)。\n');
    const line = readFileSync(join(root, path), 'utf8').split('\n').findIndex(text => text.includes('#t-99')) + 1;
    const broken = (await checkProject(repo, 'off')).findings.filter(finding => finding.code === 'AnchorNotFound');
    assert.deepEqual(broken.map(finding => ({ path: finding.path, line: finding.line })), [{ path, line }]);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
