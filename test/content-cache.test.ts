import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { ContentCache } from '../dist/content-cache.js';
import { createMemoryHawdb, hawdbIdentity, type HawdbDatabase } from '../dist/hawdb-native.js';
import { readCachePayloads, writeCachePayloads } from '../dist/cache-query.js';

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('document parse entries use real bounded HawDB and preserve undefined and caller isolation', () => {
  assert.equal(hawdbIdentity().engine, 'hawdb');
  const cache = new ContentCache<{ readonly labels: readonly string[] } | undefined>('document_parse', 'test-parser/v1', Schema.Union([Schema.Struct({ labels: Schema.Array(Schema.String) }), Schema.Undefined]));
  try {
    let parses = 0;
    const inputs = [{ path: 'a.md', source: 'alpha' }, { path: 'b.md', source: 'none' }];
    const parse = (input: { path: string; source: string }) => { parses++; return input.source === 'none' ? undefined : { labels: [input.source] }; };
    const first = cache.getMany(inputs, parse);
    assert.deepEqual(first, [{ labels: ['alpha'] }, undefined]);
    assert.equal(parses, 2);
    (first[0]!.labels as string[]).push('caller edit');
    assert.deepEqual(cache.getMany(inputs, parse), [{ labels: ['alpha'] }, undefined]);
    assert.equal(parses, 2, 'both defined and undefined entries hit HawDB');
    assert.deepEqual(cache.getMany([{ path: 'a.md', source: 'revised' }], parse), [{ labels: ['revised'] }]);
    assert.equal(parses, 3, 'current source bytes change the identity');
  } finally { cache.close(); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('batched diagnostic parsing isolates failures, preserves order, and invalidates repaired sources', () => {
  const cache = new ContentCache<string>('document_parse', 'diagnostic-test/v1', Schema.String);
  const inputs = Array.from({ length: 80 }, (_, index) => ({ path: `${index}.md`, source: index === 40 ? 'broken' : `source ${index}` }));
  let parses = 0;
  const parse = (input: { source: string }) => { parses++; if (input.source === 'broken') throw new Error('broken owner'); return input.source; };
  try {
    const cold = cache.getManyResults(inputs, parse);
    assert.equal(parses, 80);
    assert.equal(cold[40]?.ok, false);
    assert.deepEqual(cold[79], { ok: true, value: 'source 79' });
    const warm = cache.getManyResults(inputs, parse);
    assert.equal(parses, 81, 'only the failed owner is reparsed');
    assert.deepEqual(warm.map(value => value.ok), cold.map(value => value.ok));
    inputs[40] = { path: '40.md', source: 'repaired' };
    assert.deepEqual(cache.getManyResults(inputs, parse)[40], { ok: true, value: 'repaired' });
    assert.equal(parses, 82);
  } finally { cache.close(); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('collection queries select current keys from real HawDB without returning stale entries', () => {
  const db = createMemoryHawdb();
  try {
    const rows = Array.from({ length: 90 }, (_, index) => ({ key: `key-${index}`, payload: `value-${index}` }));
    db.put('code_parse', rows);
    const keys = rows.slice(10, 70).map(row => row.key).reverse();
    keys.push('absent');
    const values = readCachePayloads(db, 'code_parse', keys);
    assert.equal(values.size, 60);
    for (const key of keys) assert.equal(values.get(key), rows.find(row => row.key === key)?.payload);
    assert.equal(values.has('key-0'), false);
    assert.deepEqual([...readCachePayloads(db, 'code_parse', ['key-1'])], [['key-1', 'value-1']]);
  } finally { db.close(); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('batch writes honor UTF-8 byte quotas and preserve bounded insertion-order eviction', () => {
  const db = createMemoryHawdb();
  try {
    const rows = ['a', 'b', 'c', 'd'].map(key => ({ key, payload: '界'.repeat(50) }));
    writeCachePayloads(db, 'code_parse', rows, { maxEntries: 10, maxBytes: 500 });
    assert.deepEqual(db.scan('code_parse'), rows.slice(1));
  } finally { db.close(); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('a corrupt absent envelope cannot bypass a required cache value schema', () => {
  const cache = new ContentCache<string>('document_parse', 'required-value-test/v1', Schema.String);
  let parses = 0;
  const parse = () => { parses++; return 'valid'; };
  try {
    assert.equal(cache.get('config', 'source', parse), 'valid');
    const db = Reflect.get(cache, 'database') as HawdbDatabase;
    const row = db.scan('document_parse')[0]!;
    const envelope = JSON.parse(row.payload) as { parser: string; sourceDigest: string };
    db.put('document_parse', [{ key: row.key, payload: JSON.stringify({ parser: envelope.parser, sourceDigest: envelope.sourceDigest, present: false }) }]);
    assert.equal(cache.get('config', 'source', parse), 'valid');
    assert.equal(parses, 2);
  } finally { cache.close(); }
});
