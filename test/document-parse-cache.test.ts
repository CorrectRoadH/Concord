import { createConsumer } from './support/consumer.js';
import { setWriting } from "../src/domain/writing/index.js";
import { setConcepts } from "../src/domain/concepts/index.js";
import { digest } from "../src/model/index.js";
import { installedConcordCli } from './support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { initialize, LocalRepository } from "../src/base/workspace/index.js";
import { renderDocument } from "../src/model/index.js";
import { openHawdb } from "../src/base/cache/index.js";
import { writeProjectConfig, readProjectConfig } from './support.js';

const useCasePath = 'docs/feature/sample/use-case/inspect.md';
const researchPath = 'docs/research/sample/README.md';
function fixture() {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
  mkdirSync(join(root, 'docs/feature/sample/use-case'), { recursive: true });
  mkdirSync(join(root, 'docs/research/sample'), { recursive: true });
  writeFileSync(join(root, 'docs/feature/sample/README.md'), renderDocument({ format: 'concord.document/v1', kind: 'feature', id: 'sample', title: 'Sample' }, '# Sample\n\nA local sample.\n'));
  writeFileSync(join(root, useCasePath), renderDocument({ format: 'concord.document/v1', kind: 'use-case', id: 'inspect', title: 'Inspect', feature: 'docs/feature/sample/README.md' }, '# Inspect\n\n## Flow {#flow}\n\n1. Read the parser-sentinel source. {#read}\n2. Return the facts. {#return}\n'));
  writeFileSync(join(root, researchPath), renderDocument({ format: 'concord.document/v1', kind: 'research', id: 'sample-research', title: 'Research', createdAt: '2026-10-29', sources: [] }, '# Research\n\nLocal source bytes.\n'));
  return root;
}
function cli(root: string, dryRun: boolean, args = ['check']) {
  const result = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', ...(dryRun ? ['--dry-run'] : []), ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr);
  const value = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(result.stdout));
  assert.equal(value.error, undefined, result.stdout + result.stderr);
  return { exit: result.status, value: Object.fromEntries(Object.entries(value).filter(([name]) => !['cache', 'codeCache'].includes(name))) };
}
function parity(root: string) {
  for (const args of [['check'], ['docs', 'check'], ['memory', 'index']]) assert.deepEqual(cli(root, false, args), cli(root, true, args), args.join(' '));
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('volatile document projections preserve current CLI facts across edits, paths and policy inputs', () => Effect.runPromise(Effect.sync(() => {
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
    assert.equal(cli(root, false).value.documents, 3, 'copying prose to a supporting path does not create an owner');
    rmSync(join(root, support));
    renameSync(join(root, useCasePath), join(root, 'docs/feature/sample/use-case/renamed.md'));
    parity(root);
    mkdirSync(join(root, 'acceptance'));
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['acceptance'] });
    parity(root);
    const repo = new LocalRepository(root);
    try { setConcepts(repo, '# Concepts\n\n## Fact {#fact}\n\nA current source statement.\n', digest(readFileSync(join(root, 'docs/concepts.md'), 'utf8'))); } finally { repo.close(); }
    parity(root);
    const writer = new LocalRepository(root);
    try { setWriting(writer, { format: 'concord.writing/v3', roots: ['docs'], bannedTerms: [{ term: 'undesirable', use: 'clear', why: 'Use a concrete term' }] }, digest(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'))); } finally { writer.close(); }
    parity(root);
    assert.match(JSON.stringify(cli(root, false)), /undesirable/u);
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: true, create: false });
    try { assert.equal(new Set<string>(database.namespaces()).has('document_parse_cache'), false); }
    finally { database.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('metadata stays lazy and one tree serves repeated and duplicate requests without persistent document state', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), counts = join(root, 'parse-counts.jsonl');
  const probe = (mode?: 'off' | 'metadata') => {
    const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', fileURLToPath(new URL('./parse-count-probe.ts', import.meta.url)), fileURLToPath(new URL('./parse-cache-source-probe.ts', import.meta.url)), root, ...(mode === undefined ? [] : [mode])], {
      encoding: 'utf8', timeout: 60_000, env: { ...process.env, CONCORD_TEST_PARSE_COUNTS: counts },
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    return child.stdout;
  };
  const calls = () => existsSync(counts) ? readFileSync(counts, 'utf8').trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.String)(JSON.parse(line))) : [];
  try {
    probe('metadata');
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1, 'title derivation parses the current owner once');
    rmSync(counts);
    const first = probe();
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1, 'duplicate batch inputs and repeated steps/anchors share one parse');
    const firstCalls = calls().length;
    assert.ok(firstCalls > 0);
    rmSync(counts);
    assert.equal(probe(), first);
    assert.equal(calls().length, firstCalls, 'a fresh process reconstructs its own bounded memory cache');
    rmSync(counts);
    assert.equal(probe('off'), first);
    assert.equal(calls().filter(source => source.includes('parser-sentinel')).length, 1);
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false, 'document parsing never creates a persistent database');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('damaged persistent auxiliary caches do not change authoritative document facts', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
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
