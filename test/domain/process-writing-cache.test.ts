import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { checkWriting } from "../../src/domain/writing/index.ts";
import { openHawdb } from "../../src/base/cache/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

const policy = '# Rules\n\n句子不超过 5 个字符。\n';
async function fixture(run: (root: string, scan: (cache?: boolean) => Promise<ReturnType<typeof checkWriting>>) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-cache-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = (await LocalRepository.open(root, { initialize: true }));
  try { (await initialize(initial, false, { testRoots: [] })); } finally { initial.close(); }
  writeFileSync(join(root, 'docs/writing.md'), policy);
  writeFileSync(join(root, 'docs/corpus.md'), 'One two three.\n');
  openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: true }, nativeRuntime).close();
  const scan = async (cache = true) => {
    const repo = (await LocalRepository.open(root, { access: 'read' }));
    try { return await checkWriting(repo, undefined, cache); } finally { repo.close(); }
  };
  try { await run(root, scan); } finally { rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('writing cache validates current sources, members, policies and payload integrity', () => Effect.runPromise(Effect.tryPromise(async () => (await fixture(async (root, scan) => {
  const uncached = (await scan(false));
  if (existsSync(join(root, '.git/concord/cache.hawdb'))) {
    const db = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: true, create: false }, nativeRuntime);
    try { assert.equal(db.scan('query_cache').filter(row => row.key.startsWith('writing:')).length, 0); }
    finally { db.close(); }
  }
  const cold = (await scan());
  assert.deepEqual(cold, uncached);
  assert.ok(cold.findings.some(f => f.file === 'docs/corpus.md'));
  assert.deepEqual((await scan()), cold);
  const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false }, nativeRuntime);
  try {
    const rows = database.scan('query_cache');
    assert.equal(rows.length, 1);
    const row = rows[0]!, record = JSON.parse(row.payload);
    record.findings = [];
    database.put('query_cache', [{ key: row.key, payload: JSON.stringify(record) }]);
  } finally { database.close(); }
  assert.deepEqual((await scan()), cold, 'a valid-shaped but altered payload must be reparsed');
  writeFileSync(join(root, 'docs/corpus.md'), 'One.\n');
  assert.ok(!(await scan()).findings.some(f => f.file === 'docs/corpus.md'));
  writeFileSync(join(root, 'docs/new.md'), 'A newly added paragraph.\n');
  assert.ok((await scan()).findings.some(f => f.file === 'docs/new.md'));
  writeFileSync(join(root, 'docs/writing.md'), '{"format":"concord.writing/v3","unknown":true}');
  (await assert.rejects(async () => (await scan()), { code: 'InvalidWritingPolicy' }));
  writeFileSync(join(root, 'docs/writing.md'), policy);
  const repo = (await LocalRepository.open(root, { access: 'read' }));
  const read = repo.read.bind(repo);
  let changed = false;
  repo.read = path => {
    const result = read(path);
    if (path === 'docs/corpus.md' && !changed) { changed = true; writeFileSync(join(root, path), 'Concurrent change.\n'); }
    return result;
  };
  try { assert.throws(() => checkWriting(repo), error => error instanceof Error && 'code' in error && ['WritingInputsChanged', 'SourceChanged'].includes(String(error.code))); } finally { repo.close(); }
})))));

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('catalog bytes invalidate writing findings and changed Markdown is strictly reparsed', () => Effect.runPromise(Effect.tryPromise(async () => (await fixture(async (root, scan) => {
  const original = (await scan());
  assert.deepEqual((await scan()), original);
  const path = join(root, 'docs/concepts.md');
  writeFileSync(path, '# Terms\n\n## Issue {#issue}\n\nA durable observation.\n');
  const changed = (await scan());
  assert.notEqual(changed.inputDigest, original.inputDigest);
  assert.deepEqual((await scan()), changed);
  assert.deepEqual((await scan(false)), changed);
  writeFileSync(path, '# Terms\n\n## Missing ID\n\nDefinition.\n');
  (await assert.rejects(async () => (await scan()), { code: 'InvalidConceptCatalog' }));
})))));
