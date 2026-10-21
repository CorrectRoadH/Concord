import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { analyzeCode } from '../src/code-analysis.js';
import { LocalRepository } from '../src/storage.js';
import { createMemoryHawdb, type HawdbDatabase } from '../src/hawdb-native.js';
import { ContentCache } from '../src/content-cache.js';
import { ConcordError } from '../src/shared.js';
import { OwnedProcess, makeOwnedProcessService } from '../src/owned-process.js';
import { tracePrivateDirectorySync } from '../src/coordination.js';
import { inspectRunner } from '../src/run-coordination.js';
import { withPersistentCache } from '../src/cache-store.js';

const target = 'docs/feature/sample/use-case/sample.md';
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-lsp-lifecycle-'));
  execFileSync('git', ['init', '-q', root]);
  const cli = (...args: string[]) => execFileSync(process.execPath, [resolve('dist/entry.js'), '--root', root, '--json', ...args], { stdio: 'pipe' });
  cli('init', '--test-root', 'test', '--source-root', 'src');
  cli('feature', 'create', 'sample', '--title', 'Sample');
  cli('use-case', 'create', 'sample', '--feature', 'sample', '--title', 'Sample');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/sample.ts'), `// @concord-file\n// @concord-implements ${target}\nexport const sample = 1;\n`);
  const repo = new LocalRepository(root, { optimistic: true });
  try { repo.snapshot(() => withPersistentCache(repo, true, database => database!.put('config_cache', [{ key: 'fixture', payload: '{}' }]))); }
  finally { repo.close(); }
  return root;
}
async function analyze(root: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { return await Effect.runPromise(analyzeCode(repo).pipe(Effect.provideService(OwnedProcess, makeOwnedProcessService()))); }
  finally { repo.close(); }
}

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C6, C10: real cache reads close before owned publication.
test('analysis closes source HawDB readers before acquiring publication ownership', t => Effect.runPromise(Effect.promise(async () => {
  const root = consumer();
  const leasePath = join(tracePrivateDirectorySync(root), 'publication.lease');
  const memory = createMemoryHawdb();
  const prototype: HawdbDatabase = Object.getPrototypeOf(memory);
  memory.close();
  const active = new Set<HawdbDatabase>();
  const violations: string[] = [];
  let reads = 0, writes = 0;
  let memoryDepth = 0;
  const contentRead = ContentCache.prototype.getManyResults;
  t.mock.method(ContentCache.prototype, 'getManyResults', function(this: ContentCache<unknown>, ...args: Parameters<ContentCache<unknown>['getManyResults']>) {
    memoryDepth++;
    try { return contentRead.apply(this, args); } finally { memoryDepth--; }
  });
  const get = prototype.get, scan = prototype.scan, close = prototype.close, put = prototype.put;
  const noteRead = (database: HawdbDatabase) => {
    // Parser memoization owns process-local in-memory engines, not source handles.
    if (memoryDepth > 0) return;
    reads++; active.add(database);
    if (existsSync(leasePath)) violations.push('source read under publication lease');
  };
  t.mock.method(prototype, 'get', function(this: HawdbDatabase, ...args: Parameters<HawdbDatabase['get']>) { noteRead(this); return get.apply(this, args); });
  t.mock.method(prototype, 'scan', function(this: HawdbDatabase, ...args: Parameters<HawdbDatabase['scan']>) { noteRead(this); return scan.apply(this, args); });
  t.mock.method(prototype, 'close', function(this: HawdbDatabase) { try { return close.call(this); } finally { active.delete(this); } });
  t.mock.method(prototype, 'put', function(this: HawdbDatabase, ...args: Parameters<HawdbDatabase['put']>) {
    writes++;
    if (existsSync(leasePath) && active.size > 0) violations.push('source reader survived into publication write');
    return put.apply(this, args);
  });
  try {
    const result = await analyze(root);
    assert.ok(result.observations.every(value => value.current));
    assert.ok(reads > 0); assert.ok(writes > 0);
    assert.deepEqual(violations, []); assert.equal(active.size, 0);
    assert.equal(inspectRunner(root).status, 'absent');
    assert.equal(existsSync(leasePath), false);
  } finally { t.mock.restoreAll(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C6, C10: edits after the final source capture cannot publish.
test('analysis publication rechecks frozen source preimages after capture closes', t => Effect.runPromise(Effect.promise(async () => {
  const root = consumer();
  const original = LocalRepository.prototype.snapshot;
  let captures = 0;
  let edit = () => {};
  t.mock.method(LocalRepository.prototype, 'snapshot', function<A>(this: LocalRepository, read: () => A): A {
    const result = original.call(this, read) as A;
    if (typeof result === 'object' && result !== null && 'inputs' in result && 'identity' in result && ++captures === 2) edit();
    return result;
  });
  const source = readFileSync(join(root, 'src/sample.ts'), 'utf8');
  const contract = readFileSync(join(root, target), 'utf8');
  const config = readFileSync(join(root, 'concord.config.ts'), 'utf8');
  const edits = [
    () => writeFileSync(join(root, 'src/sample.ts'), source + '// edited\n'),
    () => writeFileSync(join(root, 'src/new-member.ts'), 'export const added = 1;\n'),
    () => writeFileSync(join(root, target), contract + '\nChanged contract.\n'),
    () => writeFileSync(join(root, 'concord.config.ts'), config + '\n// changed configuration\n'),
    () => writeFileSync(join(root, 'candidate.txt'), 'new candidate member\n'),
  ];
  try {
    for (const mutation of edits) {
      captures = 0; edit = mutation;
      await assert.rejects(analyze(root), error => error instanceof ConcordError && error.code === 'AnalysisSourceChanged');
      assert.equal(captures, 2);
      assert.equal(inspectRunner(root).status, 'absent');
      assert.equal(existsSync(join(tracePrivateDirectorySync(root), 'publication.lease')), false);
      writeFileSync(join(root, 'src/sample.ts'), source);
      writeFileSync(join(root, target), contract);
      writeFileSync(join(root, 'concord.config.ts'), config);
      rmSync(join(root, 'src/new-member.ts'), { force: true });
      rmSync(join(root, 'candidate.txt'), { force: true });
    }
    captures = 0; edit = () => {};
    assert.ok((await analyze(root)).observations.every(value => value.current));
    // Failed capture must still release the runner registered before that capture.
    writeFileSync(join(root, 'src/sample.ts'), '// @concord-end\n');
    await assert.rejects(analyze(root));
    assert.equal(inspectRunner(root).status, 'absent');
  } finally { t.mock.restoreAll(); rmSync(root, { recursive: true, force: true }); }
})));
