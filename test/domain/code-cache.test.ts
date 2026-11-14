import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { writeProjectConfig } from '../support/support.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { cacheStatus, clearCache } from "../../src/domain/tests/index.ts";
import { scanCode } from "../../src/domain/code/index.ts";
import { openHawdb, PersistentCache } from "../../src/base/cache/index.ts";
import { ConcordError, objectDigest } from '../../src/model/index.ts';

import { LocalRepository } from "../support/repository.ts";

import { traceGaps } from "../../src/app/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

const contract = 'docs/feature/local-sdlc/use-case/trace-code-ownership.md';

async function consumer(existingCache = true): Promise<string> {
  const root = (await createConsumer());
  writeProjectConfig(root, { sourceRoots: ['src'] });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord test']);
  const initial = (await LocalRepository.open(root));
  try { if (existingCache) PersistentCache.repository(initial).prepareWrite({ create: true }); } finally { initial.close(); }
  return root;
}
function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, contents);
}
function marked(symbol: string): string {
  return ['// @concord-code', `// @concord-implements ${contract}`, `export function ${symbol}() { return true; }`, ''].join('\n');
}
async function scan(root: string, options?: Parameters<typeof scanCode>[1]) {
  const repo = (await LocalRepository.open(root));
  try { if (options?.cache === 'rebuild') PersistentCache.repository(repo).prepareWrite({ create: true }); return options === undefined ? (await scanCode(repo, undefined, nativeRuntime)) : (await scanCode(repo, options, nativeRuntime)); }
  finally { repo.close(); }
}
async function open<A>(root: string, use: (repo: LocalRepository) => A): Promise<A> {
  const repo = (await LocalRepository.open(root));
  try { return await use(repo); } finally { repo.close(); }
}

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('caches code declaration parses per file and rejects a corrupt row without overwriting it', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/alpha.ts', marked('alpha'));
    write(root, 'src/beta.ts', marked('beta'));
    write(root, 'src/unmarked.ts', 'export function ignored( {\n');
    const cold = (await scan(root));
    assert.equal(cold.cache.status, 'miss');
    assert.equal(cold.cache.hits, 0);
    assert.equal(cold.cache.misses, 3);
    assert.deepEqual(cold.findings.filter(item => item.code === 'CodeParseError'), []);
    assert.equal(cold.codes.find(item => item.symbol === 'alpha')?.symbol, 'alpha');
    const warm = (await scan(root));
    assert.equal(warm.cache.status, 'hit');
    assert.equal(warm.cache.hits, 3);
    assert.equal(warm.cache.misses, 0);
    assert.equal(warm.digest, cold.digest);
    write(root, 'src/alpha.ts', marked('alphaEdited'));
    const partial = (await scan(root));
    assert.equal(partial.cache.status, 'partial');
    assert.equal(partial.cache.hits, 2);
    assert.equal(partial.cache.misses, 1);
    assert.equal(partial.codes.find(item => item.file === 'src/alpha.ts')?.symbol, 'alphaEdited');
    assert.equal(partial.codes.find(item => item.file === 'src/beta.ts')?.symbol, 'beta');
    const cache = join(root, '.git/concord/cache.hawdb');
    const db = openHawdb(cache, { readOnly: false, create: false }, nativeRuntime);
    let damaged: readonly { key: string; payload: string }[];
    try {
      const rows = db.scan('code_cache');
      assert.ok(rows.length > 0);
      damaged = rows.map(row => {
        const payload = JSON.parse(row.payload) as { codes: { symbol?: string }[]; digest: string };
        payload.digest = 'sha256:wrong';
        return { key: row.key, payload: JSON.stringify(payload) };
      });
      db.put('code_cache', damaged);
    } finally { db.close(); }
    await assert.rejects(scan(root), error => error instanceof ConcordError && error.code === 'InvalidData' && error.message.includes('code cache digest'));
    const preserved = openHawdb(cache, { readOnly: true, create: false }, nativeRuntime);
    try { assert.deepEqual(preserved.scan('code_cache'), damaged); }
    finally { preserved.close(); }
    (await open(root, repo => assert.match(cacheStatus(repo, nativeRuntime).detail ?? '', /code_cache/u)));
    (await open(root, repo => clearCache(repo, undefined, nativeRuntime)));
    assert.equal(existsSync(cache), true);
    (await open(root, repo => assert.equal(cacheStatus(repo, nativeRuntime).status, 'empty')));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('cache off does not create the code projection, and rebuild rewrites it', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer(false));
  try {
    write(root, 'src/alpha.ts', marked('alpha'));
    const disabled = (await scan(root, { cache: 'off' }));
    assert.equal(disabled.cache.status, 'off');
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false);
    const rebuilt = (await scan(root, { cache: 'rebuild' }));
    assert.equal(rebuilt.cache.status, 'miss');
    assert.equal(rebuilt.codes[0]?.symbol, 'alpha');
    const db = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false }, nativeRuntime);
    try { db.put('code_cache', db.scan('code_cache').map(row => ({ key: row.key, payload: '{' }))); }
    finally { db.close(); }
    const again = (await scan(root, { cache: 'rebuild' }));
    assert.equal(again.codes[0]?.symbol, 'alpha');
    assert.equal((await scan(root)).cache.status, 'hit');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md
test('a docs-only change still changes gaps while the code parse cache hits', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  let repo: LocalRepository | undefined;
  try {
    write(root, 'src/orders.ts', ['// @concord-file', '// @concord-implements docs/feature/orders/README.md', 'export const orders = true;', ''].join('\n'));
    repo = (await LocalRepository.open(root));
    (await createDocument(repo, 'feature', { id: 'orders', title: 'Orders', pages: ['cli'] }));
    (await createDocument(repo, 'use-case', { id: 'create-order', title: 'Create order', feature: 'orders' }));
    const first = (await traceGaps(repo));
    assert.equal(first.contracts.find(item => item.path.includes('use-case/create-order'))?.title, 'Create order');
    assert.equal(first.codeCache?.status, 'miss');
    const page = join(root, 'docs/feature/orders/use-case/create-order.md');
    writeFileSync(page, readFileSync(page, 'utf8').replaceAll('Create order', 'Create revised order'));
    const second = (await traceGaps(repo));
    assert.equal(second.contracts.find(item => item.path.includes('use-case/create-order'))?.title, 'Create revised order');
    assert.equal(second.codeCache?.status, 'hit');
    assert.notDeepEqual(second.contracts, first.contracts);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('a warm code cache ignores persistent config rows while bootstrap parses its source', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer());
  try {
    write(root, 'src/alpha.ts', marked('alpha'));
    assert.equal((await scan(root)).cache.status, 'miss');
    const cache = join(root, '.git/concord/cache.hawdb');
    const db = openHawdb(cache, { readOnly: false, create: false }, nativeRuntime);
    try {
      assert.ok(db.scan('code_cache').length > 0);
      const rows = db.scan('config_cache');
      assert.ok(rows.length > 0);
      const config = { testRoots: [], sourceRoots: [] };
      db.put('config_cache', rows.map(row => ({ key: row.key, payload: JSON.stringify({ config, digest: objectDigest(config) }) })));
    } finally { db.close(); }
    const script = `
      const nativeRuntime = { cwd: process.cwd(), env: { ...process.env } };
      import { LocalRepository } from ${JSON.stringify(fileURLToPath(new URL('../support/repository.ts', import.meta.url)))};
      import { scanCode } from ${JSON.stringify(fileURLToPath(new URL('../../src/domain/code/index.ts', import.meta.url)))};
      const repo = await LocalRepository.open(${JSON.stringify(root)});
      try {
        if (JSON.stringify(repo.config.sourceRoots) !== '["src"]') process.exit(3);
        const result = await scanCode(repo, undefined, nativeRuntime);
        if (result.cache.status !== 'hit') { console.error(JSON.stringify(result.cache)); process.exit(2); }
        if (result.codes[0]?.symbol !== 'alpha') process.exit(4);
      } finally { repo.close(); }
    `;
    const child = spawnSync(process.execPath, [ '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
