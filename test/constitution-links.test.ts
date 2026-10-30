import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createConsumer } from './support/consumer.js';
import { LocalRepository } from "../src/base/workspace/index.js";
import { createDocument } from "../src/domain/documents/index.js";
import { checkProject } from "../src/app/index.js";

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#check-links
// @issue docs/issues/constitution-body-links-unchecked.md
test('check reports a body link to a missing constitution clause with its path and line', () => {
  const root = createConsumer(); const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'feature', { id: 'cart', title: 'Cart' });
    const path = 'docs/feature/cart/README.md';
    appendFileSync(join(root, path), '\n见 [C-099](../../constitution.md#c-099)。\n');
    const line = readFileSync(join(root, path), 'utf8').split('\n').findIndex(text => text.includes('#c-099')) + 1;
    const broken = checkProject(repo, 'off').findings.filter(finding => finding.code === 'AnchorNotFound');
    assert.deepEqual(broken.map(finding => ({ path: finding.path, line: finding.line })), [{ path, line }]);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
