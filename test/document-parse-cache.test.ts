import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { renderDocument } from '../dist/documents.js';
import { DOCUMENT_PARSER_VERSION } from '../dist/document-projection.js';
import { openHawdb } from '../dist/hawdb-native.js';
import { objectDigest } from '../dist/shared.js';
import { writeProjectConfig, readProjectConfig } from './support.js';

const useCasePath = 'docs/feature/sample/use-case/inspect.md';
const researchPath = 'docs/research/sample/README.md';
const key = (path: string) => objectDigest({ path, parser: DOCUMENT_PARSER_VERSION });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-document-parse-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: [] }); } finally { repo.close(); }
  mkdirSync(join(root, 'docs/feature/sample/use-case'), { recursive: true });
  mkdirSync(join(root, 'docs/research/sample'), { recursive: true });
  writeFileSync(join(root, 'docs/feature/sample/README.md'), renderDocument({ format: 'concord.document/v1', kind: 'feature', id: 'sample', title: 'Sample', createdAt: '2026-10-29' }, '# Sample\n\nA local sample.\n'));
  writeFileSync(join(root, useCasePath), renderDocument({ format: 'concord.document/v1', kind: 'use-case', id: 'inspect', title: 'Inspect', feature: 'docs/feature/sample/README.md', createdAt: '2026-10-29' }, '# Inspect\n\n## Flow {#flow}\n\n1. Read the parser-sentinel source. {#read}\n2. Return the facts. {#return}\n'));
  writeFileSync(join(root, researchPath), renderDocument({ format: 'concord.document/v1', kind: 'research', id: 'sample-research', title: 'Research', createdAt: '2026-10-29', sources: [] }, '# Research\n\nLocal source bytes.\n'));
  return root;
}
function cli(root: string, dryRun: boolean, args = ['check']) {
  const result = spawnSync(process.execPath, ['dist/entry.js', '--root', root, '--json', ...(dryRun ? ['--dry-run'] : []), ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr);
  const value = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(result.stdout));
  assert.equal(value.error, undefined, result.stdout + result.stderr);
  return { exit: result.status, value: Object.fromEntries(Object.entries(value).filter(([name]) => !['cache', 'codeCache'].includes(name))) };
}
function parity(root: string) {
  for (const args of [['check'], ['docs', 'check'], ['memory', 'index']]) assert.deepEqual(cli(root, false, args), cli(root, true, args), args.join(' '));
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('persistent document projections preserve current CLI facts across edits, paths and policy inputs', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    parity(root); parity(root);
    const before = cli(root, false);
    writeFileSync(join(root, useCasePath), readFileSync(join(root, useCasePath), 'utf8').replace('Return the facts. {#return}', 'Return the modified undesirable facts. {#read}'));
    parity(root);
    assert.notDeepEqual(cli(root, false), before, 'current byte changes remain visible');
    const support = 'docs/feature/sample/research-copy.md';
    writeFileSync(join(root, support), readFileSync(join(root, researchPath)));
    parity(root);
    assert.match(JSON.stringify(cli(root, false)), /ResearchMigrationRequired/u, 'README bytes at a supporting path are validated there');
    rmSync(join(root, support));
    renameSync(join(root, useCasePath), join(root, 'docs/feature/sample/use-case/renamed.md'));
    parity(root);
    mkdirSync(join(root, 'acceptance'));
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['acceptance'] });
    parity(root);
    writeFileSync(join(root, 'docs/concepts.md'), '# Concepts\n\n## Fact {#fact}\n\nA current source statement.\n');
    parity(root);
    writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ format: 'concord.writing/v3', roots: ['docs'], bannedTerms: [{ term: 'undesirable', use: 'clear', why: 'Use a concrete term' }] }));
    parity(root);
    assert.match(JSON.stringify(cli(root, false)), /undesirable/u);
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: true, create: false });
    try {
      const rows = database.scan('document_parse_cache');
      assert.equal(rows.filter(row => row.key === key(useCasePath)).length, 1, 'editing replaces the stable path/parser key');
      const row = rows.find(row => row.key === key(researchPath));
      assert.ok(row);
    } finally { database.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('one source tree serves repeated metadata, steps and anchors and survives a new process without parsing', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  const counts = join(root, 'parse-counts.jsonl');
  const probe = (off = false) => {
    const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', fileURLToPath(new URL('./parse-count-probe.ts', import.meta.url)), fileURLToPath(new URL('./parse-cache-source-probe.ts', import.meta.url)), root, ...(off ? ['off'] : [])], {
      encoding: 'utf8', timeout: 60_000, env: { ...process.env, CONCORD_TEST_PARSE_COUNTS: counts },
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    return child.stdout;
  };
  const calls = () => existsSync(counts) ? readFileSync(counts, 'utf8').trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.String)(JSON.parse(line))) : [];
  try {
    const cold = probe();
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1);
    const coldCalls = calls().length;
    assert.ok(coldCalls > 0);
    rmSync(counts);
    assert.equal(probe(), cold);
    assert.equal(calls().length, 0, 'the entire second process uses strictly decoded durable trees');
    assert.equal(probe(true), cold);
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1, 'cache-off parses once in its own process');
    rmSync(counts);
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
    try {
      const row = database.get('document_parse_cache', [key(useCasePath)])[0]!;
      const envelope = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(row.payload));
      const value = { ...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(envelope.value), tree: 'damaged compressed tree' };
      database.put('document_parse_cache', [{ key: row.key, payload: JSON.stringify({ ...envelope, value, valueDigest: objectDigest(value) }) }]);
    } finally { database.close(); }
    assert.equal(probe(), cold);
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1, 'invalid syntax trees are strictly decoded, reparsed and repaired');
    rmSync(counts);
    assert.equal(probe(), cold);
    assert.equal(calls().length, 0);
    const publicCheck = () => {
      const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', fileURLToPath(new URL('./parse-count-probe.ts', import.meta.url)), 'dist/entry.js', '--root', root, '--json', 'check'], {
        encoding: 'utf8', timeout: 60_000, env: { ...process.env, CONCORD_TEST_PARSE_COUNTS: counts },
      });
      assert.ok(child.status === 0 || child.status === 1, child.stdout + child.stderr);
      return Object.fromEntries(Object.entries(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(child.stdout))).filter(([name]) => !['cache', 'codeCache'].includes(name)));
    };
    const firstCheck = publicCheck();
    assert.ok(calls().length > 0, 'cold writing and constitution inputs exercise the actual CLI parser');
    rmSync(counts);
    assert.deepEqual(publicCheck(), firstCheck);
    assert.equal(calls().length, 0, 'the second public check process makes no Markdown parser calls');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('damaged envelopes and trees are misses, and copied projections cannot override location rules', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    const expected = cli(root, false);
    const path = join(root, '.git/concord/cache.hawdb');
    const edit = (change: (envelope: Record<string, unknown>) => string) => {
      const db = openHawdb(path, { readOnly: false, create: false });
      try {
        const row = db.get('document_parse_cache', [key(useCasePath)])[0]!;
        const envelope = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(row.payload));
        db.put('document_parse_cache', [{ key: row.key, payload: change({ ...envelope }) }]);
      } finally { db.close(); }
      assert.deepEqual(cli(root, false), expected);
      parity(root);
    };
    edit(() => '{bad json');
    edit(envelope => JSON.stringify({ ...envelope, path: researchPath }));
    edit(envelope => JSON.stringify({ ...envelope, parser: 'old parser' }));
    edit(envelope => JSON.stringify({ ...envelope, sourceDigest: 'old bytes' }));
    edit(envelope => {
      const value = { tree: { type: 'root', children: [], unexpected: true } };
      return JSON.stringify({ ...envelope, value, valueDigest: objectDigest(value) });
    });
    edit(envelope => JSON.stringify({ ...envelope, value: { tree: { type: 'root', children: [] } } }));
    const target = 'docs/feature/sample/copied.md';
    writeFileSync(join(root, target), readFileSync(join(root, researchPath)));
    const db = openHawdb(path, { readOnly: false, create: false });
    try {
      const row = db.get('document_parse_cache', [key(researchPath)])[0]!;
      db.put('document_parse_cache', [{ key: key(target), payload: row.payload }]);
    } finally { db.close(); }
    parity(root);
    assert.match(JSON.stringify(cli(root, false)), /ResearchMigrationRequired/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('the persistent parse namespace enforces native entry and UTF-8 byte quotas', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  const path = join(root, '.git/concord/cache.hawdb');
  let db = openHawdb(path, { readOnly: false, create: true });
  try {
    for (let batch = 0; batch < 11; batch++) {
      db.put('document_parse_cache', Array.from({ length: 1000 }, (_, index) => ({ key: `entry-${batch * 1000 + index}`, payload: 'x' })), { maxEntries: 20_000, maxBytes: 32 * 1024 * 1024 });
      // Exercise durable generations rather than exhausting transient SQL overlays.
      db.close(); db = openHawdb(path, { readOnly: false, create: false });
    }
    assert.equal(db.scan('document_parse_cache').length, 10_000);
    assert.equal(db.get('document_parse_cache', ['entry-0']).length, 0);
    db.close(); db = openHawdb(join(root, 'byte-cache'), { readOnly: false, create: true });
    const payload = '界'.repeat(1024 * 1024); // 3 MiB UTF-8, despite its shorter JS length.
    for (let index = 0; index < 8; index++) db.put('document_parse_cache', [{ key: String(index), payload }], { maxEntries: 20_000, maxBytes: 32 * 1024 * 1024 });
    const rows = db.scan('document_parse_cache');
    assert.equal(rows.length, 7, '24 MiB includes namespace and key bytes');
    assert.ok(rows.reduce((bytes, row) => bytes + Buffer.byteLength('document_parse_cache') + Buffer.byteLength(row.key) + Buffer.byteLength(row.payload), 0) <= 24 * 1024 * 1024);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
})));
