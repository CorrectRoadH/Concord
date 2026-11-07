import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
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

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

async function cli(root: string, dryRun: boolean, args = ['check']) {
  const repo = (await LocalRepository.open(root, { access: 'read', dryRun, persistentCache: dryRun ? 'off' : 'use' }));
  try {
    const value = (await repo.snapshot(async () => args[0] === 'check' ? (await checkProject(repo, dryRun ? 'off' : 'use'))
      : args[0] === 'docs' ? checkWriting(repo, undefined, !dryRun) : knowledgeIndex(repo, 'memory')));
    return { exit: 'ok' in value && !value.ok ? 1 : 0, value: Object.fromEntries(Object.entries(value).filter(([name]) => !['cache', 'codeCache'].includes(name))) };
  } finally { repo.close(); }
}
async function parity(root: string) {
  for (const args of [['check'], ['docs', 'check'], ['list', 'memory']]) assert.deepEqual((await cli(root, false, args)), (await cli(root, true, args)), args.join(' '));
}
async function existingCacheFixture(): Promise<string> {
  const root = (await fixture()), repo = (await LocalRepository.open(root));
  try { PersistentCache.repository(repo).prepareWrite({ create: true }); } finally { repo.close(); }
  return root;
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('volatile document projections preserve current CLI facts across edits, paths and policy inputs', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await existingCacheFixture());
  try {
    (await parity(root)); (await parity(root));
    const before = (await cli(root, false));
    writeFileSync(join(root, useCasePath), readFileSync(join(root, useCasePath), 'utf8').replace('Return the facts. {#return}', 'Return the modified undesirable facts. {#read}'));
    (await parity(root));
    assert.notDeepEqual((await cli(root, false)), before, 'current byte changes remain visible');
    const support = 'docs/feature/sample/engineering-copy.md';
    writeFileSync(join(root, support), readFileSync(join(root, engineeringPath)));
    (await parity(root));
    assert.equal((await cli(root, false)).value.documents, 3, 'copying prose to a supporting path does not create an owner');
    rmSync(join(root, support));
    renameSync(join(root, useCasePath), join(root, 'docs/feature/sample/use-case/renamed.md'));
    (await parity(root));
    mkdirSync(join(root, 'acceptance'));
    writeProjectConfig(root, { ...(await readProjectConfig(root)), testRoots: ['acceptance'] });
    (await parity(root));
    const repo = (await LocalRepository.open(root));
    try { (await writeConceptFile(repo, '# Concepts\n\n## Fact {#fact}\n\nA current source statement.\n', digest(readFileSync(join(root, 'docs/concepts.md'), 'utf8')))); } finally { repo.close(); }
    (await parity(root));
    const writer = (await LocalRepository.open(root));
    try { (await writeWritingFile(writer, { roots: ['docs'], bannedTerms: [{ term: 'undesirable', use: 'clear', why: 'Use a concrete term' }] }, digest(readFileSync(join(root, 'docs/writing.md'), 'utf8')))); } finally { writer.close(); }
    (await parity(root));
    assert.match(JSON.stringify((await cli(root, false))), /undesirable/u);
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: true, create: false }, nativeRuntime);
    try { assert.equal(new Set<string>(database.namespaces()).has('document_parse_cache'), false); }
    finally { database.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('damaged persistent auxiliary caches do not change authoritative document facts', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await existingCacheFixture());
  try {
    const expected = (await cli(root, false));
    const db = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false }, nativeRuntime);
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
    assert.deepEqual((await cli(root, false)), expected);
    (await parity(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
