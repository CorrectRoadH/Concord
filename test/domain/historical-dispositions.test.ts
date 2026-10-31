import { createDocument, initialize } from '../support/operations.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { authorDesignFixture } from '../support/design-fixture.js';
import { checkDocuments, findDocument, loadDocuments } from "../../src/domain/documents/index.js";

import { deferDesign, decideDesign } from "../../src/domain/designs/index.js";
import { renderDocument } from "../../src/model/index.js";
import { LocalRepository } from "../support/repository.js";


// @use-case docs/feature/document-packages/use-case/discover-managed-documents.md
test('a Design decision replaces its current Deferred declaration', t => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-dispositions-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  t.after(() => { repo.close(); rmSync(root, { recursive: true, force: true }); });
  initialize(repo);
  createDocument(repo, 'design', { id: 'deferred', title: 'Deferred', alternatives: ['one', 'two'] });
  authorDesignFixture(root, 'deferred', ['one', 'two'], 'one', false);
  deferDesign(repo, 'deferred', 'Awaiting offline evidence');
  const deferred = findDocument(loadDocuments(repo), 'deferred', 'design');
  assert.equal(deferred.metadata.kind === 'design' ? deferred.metadata.deferral?.reason : undefined, 'Awaiting offline evidence');
  decideDesign(repo, 'deferred', 'one', [], 'Evidence is now available');
  const selected = findDocument(loadDocuments(repo), 'deferred', 'design');
  assert(selected.metadata.kind === 'design');
  assert.equal(selected.metadata.deferral, undefined);
  assert.equal(selected.metadata.decision?.selected, 'one');
  assert.deepEqual(checkDocuments(repo, loadDocuments(repo)), []);
})));
