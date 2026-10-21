import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { checkWriting } from '../dist/writing.js';
import { openHawdb } from '../dist/hawdb-native.js';

const policy = JSON.stringify({ format: 'concord.writing/v3', roots: ['docs'], bannedTerms: [], sentenceLength: 5 });
function fixture(run: (root: string, scan: (cache?: boolean) => ReturnType<typeof checkWriting>) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-cache-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { testRoots: [] }); } finally { initial.close(); }
  writeFileSync(join(root, 'docs/concord-writing.json'), policy);
  writeFileSync(join(root, 'docs/corpus.md'), 'One two three.\n');
  const scan = (cache = true) => {
    const repo = new LocalRepository(root, { access: 'read' });
    try { return checkWriting(repo, undefined, cache); } finally { repo.close(); }
  };
  try { run(root, scan); } finally { rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
test('writing cache validates current sources, members, policies and payload integrity', () => Effect.runPromise(Effect.sync(() => fixture((root, scan) => {
  const uncached = scan(false);
  if (existsSync(join(root, '.git/concord/cache.hawdb'))) {
    const db = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: true, create: false });
    try { assert.equal(db.scan('query_cache').filter(row => row.key.startsWith('writing:')).length, 0); }
    finally { db.close(); }
  }
  const cold = scan();
  assert.deepEqual(cold, uncached);
  assert.ok(cold.findings.some(f => f.file === 'docs/corpus.md'));
  assert.deepEqual(scan(), cold);
  const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
  try {
    const rows = database.scan('query_cache');
    assert.equal(rows.length, 1);
    const row = rows[0]!, record = JSON.parse(row.payload);
    record.findings = [];
    database.put('query_cache', [{ key: row.key, payload: JSON.stringify(record) }]);
  } finally { database.close(); }
  assert.deepEqual(scan(), cold, 'a valid-shaped but altered payload must be reparsed');
  writeFileSync(join(root, 'docs/corpus.md'), 'One.\n');
  assert.ok(!scan().findings.some(f => f.file === 'docs/corpus.md'));
  writeFileSync(join(root, 'docs/new.md'), 'A newly added paragraph.\n');
  assert.ok(scan().findings.some(f => f.file === 'docs/new.md'));
  writeFileSync(join(root, 'docs/concord-writing.json'), '{"format":"concord.writing/v3","unknown":true}');
  assert.throws(() => scan(), { code: 'InvalidWritingPolicy' });
  writeFileSync(join(root, 'docs/concord-writing.json'), policy);
  const repo = new LocalRepository(root, { access: 'read' });
  const read = repo.read.bind(repo);
  let changed = false;
  repo.read = path => {
    const result = read(path);
    if (path === 'docs/corpus.md' && !changed) { changed = true; writeFileSync(join(root, path), 'Concurrent change.\n'); }
    return result;
  };
  try { assert.throws(() => checkWriting(repo), { code: 'WritingInputsChanged' }); } finally { repo.close(); }
}))));

// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
test('a new public CLI process reuses validated writing findings without loading the prose parser', () => Effect.runPromise(Effect.sync(() => fixture((root, scan) => {
  const loaded = join(root, 'loaded.json');
  const modules = () => {
    let output = '';
    try {
      output = execFileSync(process.execPath, ['--import', fileURLToPath(import.meta.resolve('tsx')), '--import', fileURLToPath(new URL('./cli-load-probe.ts', import.meta.url)), fileURLToPath(new URL('../dist/entry.js', import.meta.url)), '--root', root, 'docs', 'check', '--json'], {
        encoding: 'utf8', env: { ...process.env, CONCORD_TEST_LOADED_MODULES: loaded }, stdio: 'pipe',
      });
    } catch (cause) {
      const result = cause as { status: number; stdout: string; stderr: string };
      assert.equal(result.status, 1, 'findings produce the normal nonzero result');
      output = result.stdout || result.stderr;
    }
    assert.equal(JSON.parse(output).operation, 'docs-check', output);
    return JSON.parse(readFileSync(loaded, 'utf8')) as string[];
  };
  const cold = modules();
  assert.ok(cold.some(path => path.includes('/mdast-util-from-markdown/')), 'cold positive control must observe prose parsing');
  const warm = modules();
  assert.ok(warm.some(path => path.endsWith('/dist/writing.js')));
  assert.ok(warm.every(path => !path.includes('/mdast-util-from-markdown/')));
  assert.deepEqual(scan(false), scan(), 'cache-disabled overlay analysis has identical findings');
}))));
