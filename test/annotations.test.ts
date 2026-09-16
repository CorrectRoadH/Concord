import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, initialize } from '../dist/storage.js';
import { cacheStatus, clearCache, scanAnnotations } from '../dist/annotations.js';

function consumer() {
  const root = mkdtempSync(join(tmpdir(), 'concord-annotations-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord test']);
  const initial = new LocalRepository(root, { initialize: true }); initialize(initial); initial.close();
  return root;
}
function write(root: string, relative: string, contents: string) { const path = join(root, relative); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, contents); }
function scan(root: string, options?: Parameters<typeof scanAnnotations>[1]) { const repo = new LocalRepository(root); try { return options === undefined ? scanAnnotations(repo) : scanAnnotations(repo, options); } finally { repo.close(); } }

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('indexes real runner imports and safely rebuilds SQLite projections', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'test/example.test.mjs', `import spec from 'node:test';
// @feature docs/feature/parser/README.md
// @regression docs/memory/parser-bug.md
spec('parses comments', () => {});
// @feature docs/feature/parser/README.md
// @status retired
spec.skip('old parser', () => {});
function test() {}
test('ordinary helper', () => {});
const text = '// this is ordinary text, not a Concord annotation';
const caseId = 'template-case';
const contract = 'feature/template';
const interpolatedFixture = \`// @feature \${contract}
// @regression \${caseId}\`;
`);
    const cold = scan(root);
    assert.equal(cold.cache.status, 'miss'); assert.equal(cold.cases.length, 2);
    assert.deepEqual(cold.findings, []);
    assert.equal(cold.cases.find(item => item.name === 'old parser')?.skipped, true);
    assert.equal(cold.cases.find(item => item.name === 'old parser')?.status, 'retired');
    const warm = scan(root); assert.equal(warm.cache.status, 'hit'); assert.equal(warm.digest, cold.digest);
    write(root, 'test/example.test.mjs', `import { test } from 'vitest';
// @feature docs/feature/new-parser/README.md
test('parses comments v2', { skip: true }, () => {});
`);
    const modified = scan(root); assert.equal(modified.cache.status, 'miss'); assert.equal(modified.cases[0]?.contract, 'docs/feature/new-parser/README.md');
    renameSync(join(root, 'test/example.test.mjs'), join(root, 'test/renamed.test.mjs'));
    const renamed = scan(root); assert.equal(renamed.cases[0]?.file, 'test/renamed.test.mjs');
    rmSync(join(root, 'test/renamed.test.mjs'));
    const deleted = scan(root); assert.equal(deleted.cases.length, 0);
    const repo = new LocalRepository(root); try { assert.equal(clearCache(repo).status, 'cleared'); assert.equal(cacheStatus(repo).status, 'empty'); } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('reports unsupported, duplicate, orphan annotations and a corrupt cache without trusting it', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'test/findings.test.ts', `import * as nodeTest from 'node:test';
// @feature docs/feature/a/README.md
nodeTest.test('first', () => {});
// @feature docs/feature/b/README.md
nodeTest.test('first', () => {});
// @feature docs/feature/a/README.md
const value = 1;
nodeTest.test.each([])('dynamic', () => {});
const fake = ` + '`ordinary text: @feature template-fake`' + `;
`);
    const first = scan(root);
    assert.ok(first.findings.some(item => item.code === 'AmbiguousTestDeclaration'));
    assert.ok(first.findings.some(item => item.code === 'OrphanAnnotation'));
    assert.equal(first.findings.filter(item => item.code === 'OrphanAnnotation').length, 1);
    assert.ok(first.findings.some(item => item.code === 'UnsupportedTestDeclaration'));
    const repo = new LocalRepository(root); let path: string;
    try { path = repo.privateDir + '/cache.sqlite'; } finally { repo.close(); }
    writeFileSync(path, 'not a sqlite database');
    const recovered = scan(root);
    assert.equal(recovered.cache.status, 'unavailable');
    assert.equal(recovered.cases.length, 2);
    rmSync(path);
    const db = new DatabaseSync(path); try {
      db.exec('CREATE TABLE annotation_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
      db.prepare('INSERT INTO annotation_cache (cache_key, payload) VALUES (?, ?)').run('corrupt-but-json', JSON.stringify({ cases: [], findings: [], files: [], digest: 'sha256:not-a-real-digest' }));
    } finally { db.close(); }
    const source = `import { test } from 'node:test';\n// @feature docs/feature/a/README.md\ntest('valid', () => {});\n`;
    write(root, 'test/findings.test.ts', source);
    const seeded = scan(root); assert.equal(seeded.cases.length, 1);
    const cache = new DatabaseSync(path); try {
      const row = cache.prepare('SELECT cache_key FROM annotation_cache WHERE cache_key != ? LIMIT 1').get('corrupt-but-json');
      assert.ok(row);
      const cacheKey = row.cache_key;
      if (typeof cacheKey !== 'string') assert.fail('cache_key must be a string');
      cache.prepare('UPDATE annotation_cache SET payload = ? WHERE cache_key = ?').run(JSON.stringify({ cases: [], findings: [], files: [], digest: 'sha256:not-a-real-digest' }), cacheKey);
    } finally { cache.close(); }
    const digestRecovered = scan(root);
    assert.equal(digestRecovered.cache.status, 'unavailable');
    assert.equal(digestRecovered.cases.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
