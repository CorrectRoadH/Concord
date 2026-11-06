import { writeConceptFile, writeWritingFile } from '../support/writing-files.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import {} from '../../src/domain/writing/index.ts';
import {} from '../../src/domain/concepts/index.ts';
import { digest } from '../../src/model/index.ts';
import { checkProject, knowledgeIndex } from '../../src/app/index.ts';
import { checkWriting } from '../../src/domain/writing/index.ts';
import { openHawdb, PersistentCache } from '../../src/base/cache/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig, readProjectConfig } from '../support/support.ts';
import { fixture, useCasePath, engineeringPath } from '../support/document-cache-fixture.ts';

function cli(root: string, dryRun: boolean, args = ['check']) {
  const repo = new LocalRepository(root, { access: 'read', dryRun, persistentCache: dryRun ? 'off' : 'use' });
  try {
    const value = repo.snapshot(() => args[0] === 'check' ? checkProject(repo, dryRun ? 'off' : 'use')
      : args[0] === 'docs' ? checkWriting(repo, undefined, !dryRun) : knowledgeIndex(repo, 'memory'));
    return { exit: 'ok' in value && !value.ok ? 1 : 0, value: Object.fromEntries(Object.entries(value).filter(([name]) => !['cache', 'codeCache'].includes(name))) };
  } finally { repo.close(); }
}
function parity(root: string) {
  for (const args of [['check'], ['docs', 'check'], ['list', 'memory']]) assert.deepEqual(cli(root, false, args), cli(root, true, args), args.join(' '));
}
function existingCacheFixture(): string {
  const root = fixture(), repo = new LocalRepository(root);
  try { PersistentCache.repository(repo).prepareWrite({ create: true }); } finally { repo.close(); }
  return root;
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('volatile document projections preserve current CLI facts across edits, paths and policy inputs', () => Effect.runPromise(Effect.sync(() => {
  const root = existingCacheFixture();
  try {
    parity(root); parity(root);
    const before = cli(root, false);
    writeFileSync(join(root, useCasePath), readFileSync(join(root, useCasePath), 'utf8').replace('Return the facts. {#return}', 'Return the modified undesirable facts. {#read}'));
    parity(root);
    assert.notDeepEqual(cli(root, false), before, 'current byte changes remain visible');
    const support = 'docs/feature/sample/engineering-copy.md';
    writeFileSync(join(root, support), readFileSync(join(root, engineeringPath)));
    parity(root);
    assert.equal(cli(root, false).value.documents, 3, 'copying prose to a supporting path does not create an owner');
    rmSync(join(root, support));
    renameSync(join(root, useCasePath), join(root, 'docs/feature/sample/use-case/renamed.md'));
    parity(root);
    mkdirSync(join(root, 'acceptance'));
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['acceptance'] });
    parity(root);
    const repo = new LocalRepository(root);
    try { writeConceptFile(repo, '# Concepts\n\n## Fact {#fact}\n\nA current source statement.\n', digest(readFileSync(join(root, 'docs/concepts.md'), 'utf8'))); } finally { repo.close(); }
    parity(root);
    const writer = new LocalRepository(root);
    try { writeWritingFile(writer, { roots: ['docs'], bannedTerms: [{ term: 'undesirable', use: 'clear', why: 'Use a concrete term' }] }, digest(readFileSync(join(root, 'docs/writing.md'), 'utf8'))); } finally { writer.close(); }
    parity(root);
    assert.match(JSON.stringify(cli(root, false)), /undesirable/u);
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: true, create: false });
    try { assert.equal(new Set<string>(database.namespaces()).has('document_parse_cache'), false); }
    finally { database.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('damaged persistent auxiliary caches do not change authoritative document facts', () => Effect.runPromise(Effect.sync(() => {
  const root = existingCacheFixture();
  try {
    const expected = cli(root, false);
    const db = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
    let damaged = 0;
    try {
      for (const namespace of ['annotation_cache', 'query_cache', 'config_cache'] as const) {
        const rows = db.scan(namespace);
        if (rows.length === 0) continue;
        db.put(namespace, rows.map(row => ({ key: row.key, payload: '{invalid json' })));
        damaged += rows.length;
      }
    } finally { db.close(); }
    assert.ok(damaged > 0);
    assert.deepEqual(cli(root, false), expected);
    parity(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
