import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { WorkspaceProjectionSchema } from '../../src/model/index.ts';
import { displaySnapshot } from '../support/workspace-display-fixture.ts';

// @feature docs/feature/web-workbench/README.md
test('workspace projection requires the source identity and rejects retired consistency fields', () => {
  const decode = Schema.decodeUnknownSync(WorkspaceProjectionSchema, { onExcessProperty: 'error' });
  const response = { snapshot: { ...displaySnapshot, cache: { status: 'ready' }, diagnostics: { error: 'FixtureDiagnostic', message: 'No diagnostic requested.' } }, projection: {
    sourceDigest: 'sha256:fixture', status: 'ready', current: false, refreshOwner: 'active',
    builtAt: '2026-10-31T00:00:00.000Z', builtFrom: '2026-10-31T00:00:00.000Z', builtUntil: '2026-10-31T00:00:00.000Z',
    complete: true, changedPaths: [], unknownRelations: false,
  } };
  assert.equal(decode(response).projection.sourceDigest, 'sha256:fixture');
  const { sourceDigest: _sourceDigest, ...missingIdentity } = response.projection;
  assert.throws(() => decode({ ...response, projection: missingIdentity }));
  assert.throws(() => decode({ ...response, projection: { ...response.projection, consistent: true } }));
});
