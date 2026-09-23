import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { ContentCache } from '../dist/content-cache.js';
import { hawdbIdentity } from '../dist/hawdb-native.js';

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
