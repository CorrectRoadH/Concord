import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { cacheStatus, clearCache } from '../dist/annotations.js';
import { scanCode } from '../dist/code.js';
import { openHawdb } from '../dist/hawdb-native.js';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { traceGaps } from '../dist/trace.js';

const contract = 'docs/feature/local-sdlc/use-case/trace-code-ownership.md';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-code-cache-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord test']);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { sourceRoots: ['src'] }); } finally { initial.close(); }
  return root;
}
function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, contents);
}
function marked(symbol: string): string {
  return ['// @concord-code', `// @concord-implements ${contract}`, `export function ${symbol}() { return true; }`, ''].join('\n');
}
function scan(root: string, options?: Parameters<typeof scanCode>[1]) {
  const repo = new LocalRepository(root);
  try { return options === undefined ? scanCode(repo) : scanCode(repo, options); }
  finally { repo.close(); }
}
function open<A>(root: string, use: (repo: LocalRepository) => A): A {
  const repo = new LocalRepository(root);
  try { return use(repo); } finally { repo.close(); }
}

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('caches code declaration parses per file and repairs a corrupt row', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/alpha.ts', marked('alpha'));
    write(root, 'src/beta.ts', marked('beta'));
    write(root, 'src/unmarked.ts', 'export function ignored( {\n');
    const cold = scan(root);
    assert.equal(cold.cache.status, 'miss');
    assert.equal(cold.cache.hits, 0);
    assert.equal(cold.cache.misses, 3);
    assert.deepEqual(cold.findings.filter(item => item.code === 'CodeParseError'), []);
    assert.equal(cold.codes.find(item => item.symbol === 'alpha')?.symbol, 'alpha');
    const warm = scan(root);
    assert.equal(warm.cache.status, 'hit');
    assert.equal(warm.cache.hits, 3);
    assert.equal(warm.cache.misses, 0);
    assert.equal(warm.digest, cold.digest);
    write(root, 'src/alpha.ts', marked('alphaEdited'));
    const partial = scan(root);
    assert.equal(partial.cache.status, 'partial');
    assert.equal(partial.cache.hits, 2);
    assert.equal(partial.cache.misses, 1);
    assert.equal(partial.codes.find(item => item.file === 'src/alpha.ts')?.symbol, 'alphaEdited');
    assert.equal(partial.codes.find(item => item.file === 'src/beta.ts')?.symbol, 'beta');
    const cache = join(root, '.git/concord/cache.hawdb');
    const db = openHawdb(cache, { readOnly: false, create: false });
    try {
      const rows = db.scan('code_cache');
      assert.ok(rows.length > 0);
      for (const row of rows) {
        const payload = JSON.parse(row.payload) as { codes: { symbol?: string }[]; digest: string };
        payload.codes[0] = { ...(payload.codes[0] ?? {}), symbol: 'stale-cache-symbol' };
        db.put('code_cache', [{ key: row.key, payload: JSON.stringify(payload) }]);
      }
    } finally { db.close(); }
    const repaired = scan(root);
    assert.equal(repaired.codes.some(item => item.symbol === 'stale-cache-symbol'), false);
    assert.equal(repaired.cache.status === 'miss' || repaired.cache.status === 'partial', true);
    const afterRepair = scan(root);
    assert.equal(afterRepair.cache.status, 'hit');
    assert.equal(afterRepair.codes.find(item => item.file === 'src/alpha.ts')?.symbol, 'alphaEdited');
    open(root, repo => assert.match(cacheStatus(repo).detail ?? '', /code_cache/u));
    open(root, repo => clearCache(repo));
    assert.equal(existsSync(cache), true);
    open(root, repo => assert.equal(cacheStatus(repo).status, 'empty'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('cache off does not create the code projection, and rebuild rewrites it', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/alpha.ts', marked('alpha'));
    const disabled = scan(root, { cache: 'off' });
    assert.equal(disabled.cache.status, 'off');
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false);
    const rebuilt = scan(root, { cache: 'rebuild' });
    assert.equal(rebuilt.cache.status, 'miss');
    assert.equal(rebuilt.codes[0]?.symbol, 'alpha');
    const db = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
    try { db.put('code_cache', db.scan('code_cache').map(row => ({ key: row.key, payload: '{' }))); }
    finally { db.close(); }
    const again = scan(root, { cache: 'rebuild' });
    assert.equal(again.codes[0]?.symbol, 'alpha');
    assert.equal(scan(root).cache.status, 'hit');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md
test('a docs-only change still changes gaps while the code parse cache hits', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  let repo: LocalRepository | undefined;
  try {
    write(root, 'src/orders.ts', ['// @concord-file', '// @concord-implements docs/feature/orders/README.md', 'export const orders = true;', ''].join('\n'));
    repo = new LocalRepository(root);
    createDocument(repo, 'feature', { id: 'orders', title: 'Orders', pages: ['cli'] });
    createDocument(repo, 'use-case', { id: 'create-order', title: 'Create order', feature: 'orders' });
    const first = traceGaps(repo);
    assert.equal(first.contracts.find(item => item.kind === 'use-case')?.title, 'Create order');
    assert.equal(first.codeCache?.status, 'miss');
    const page = join(root, 'docs/feature/orders/use-case/create-order.md');
    writeFileSync(page, readFileSync(page, 'utf8').replaceAll('Create order', 'Create revised order'));
    const second = traceGaps(repo);
    assert.equal(second.contracts.find(item => item.kind === 'use-case')?.title, 'Create revised order');
    assert.equal(second.codeCache?.status, 'hit');
    assert.notDeepEqual(second.contracts, first.contracts);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('a warm code and config cache hit does not load the TypeScript compiler', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    write(root, 'src/alpha.ts', marked('alpha'));
    assert.equal(scan(root).cache.status, 'miss');
    const cache = join(root, '.git/concord/cache.hawdb');
    const db = openHawdb(cache, { readOnly: true, create: false });
    try {
      assert.ok(db.scan('code_cache').length > 0);
      assert.ok(db.scan('config_cache').length > 0);
    } finally { db.close(); }
    const script = `
      import { createRequire } from 'node:module';
      import { LocalRepository } from ${JSON.stringify(join(dist, 'storage.js'))};
      import { scanCode } from ${JSON.stringify(join(dist, 'code.js'))};
      const repo = new LocalRepository(${JSON.stringify(root)});
      try {
        const result = scanCode(repo);
        if (result.cache.status !== 'hit') { console.error(JSON.stringify(result.cache)); process.exit(2); }
      } finally { repo.close(); }
      const loaded = Object.keys(createRequire(import.meta.url).cache).some(key => key.replaceAll('\\\\', '/').endsWith('/typescript/lib/typescript.js'));
      if (loaded) process.exit(3);
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.equal(createRequire(import.meta.url).resolve('typescript/package.json').endsWith('package.json'), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
