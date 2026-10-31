import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { digest } from '../../src/model/index.js';
import { createConsumer } from '../support/consumer.js';
import { fetchFresh, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.js';
import { startViewServer } from '../e2e/server.js';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/http-write-skips-server-lock-check.md
test('HTTP operations verify the held server lock before handing a write to the idle process', { timeout: 15_000 }, async () => {
  const root = createConsumer();
  writeProjectConfig(root, { sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'), { recursive: true });
  const path = 'src/authority.ts', before = 'export const original = true;\n';
  writeFileSync(join(root, path), before);
  const server = await startViewServer({ root });
  try {
    await waitForWorkspaceProjection(new URL(server.address).origin);
    const lock = join(root, '.git/concord/server/lock');
    renameSync(lock, `${lock}.saved`);
    writeFileSync(lock, '', { flag: 'wx', mode: 0o600 });
    const response = await fetchFresh(new URL('/api/action', server.address).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'source.set', path, body: 'export const unauthorized = true;\n', expectedDigest: digest(before) }) });
    const body: unknown = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(false), error: Schema.Literal('ServerLockUnavailable'), message: Schema.String, details: Schema.optional(Schema.Unknown) }), { onExcessProperty: 'error' })(body);
    assert.equal(readFileSync(join(root, path), 'utf8'), before, 'loss of the service lock cannot authorize a source publication');
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});
