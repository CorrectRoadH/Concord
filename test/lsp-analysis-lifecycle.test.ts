import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { buildSync } from 'esbuild';
import { readProjectConfig, writeProjectConfig, pollUntil } from './support.js';
import { createConsumer } from './support/consumer.js';
import { analyzeCode } from "../src/app/index.js";
import { createDocument } from "../src/app/index.js";
import { LocalRepository } from "./support/repository.js";
import { openHawdb } from "../src/base/cache/index.js";
import { ConcordError } from "../src/model/index.js";
import { OwnedProcessLive } from "../src/base/process/index.js";
import { tracePrivateDirectorySync } from "../src/base/publication/index.js";
import { inspectRunner } from "../src/base/publication/index.js";
import { collectNativeTests } from "../src/domain/tests/index.js";

const target = 'docs/feature/sample/use-case/sample.md';
function consumer(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'feature', { id: 'sample', title: 'Sample' });
    createDocument(repo, 'use-case', { id: 'sample', feature: 'sample', title: 'Sample' });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/sample.ts'), `// @concord-file\n// @concord-implements ${target}\nexport const sample = 1;\n`);
  writeFileSync(join(root, 'src/sample.py'), `# @concord-code\n# @concord-implements ${target}\ndef implementation():\n    return 1\n`);
  buildSync({ entryPoints: ['test/fixtures/lsp-server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'server.mjs'), logLevel: 'silent' });
  writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{
    id: 'fixture', languageId: 'python', extensions: ['.py'], argv: [process.execPath, 'server.mjs'], cwd: '.', environment: [],
    initializationOptions: { mode: 'normal', auditPath: join(root, '.git/server-audit'), gatePath: join(root, '.git/server-continue') },
    implementationFiles: ['server.mjs'], sourceFiles: [], budgets: { totalMs: 30000, requestMs: 10000 },
    profile: { version: 'fixture-v1', serverVersion: '1.0.0', commentPrefixes: ['#'], declarationKinds: [5, 6, 12], symbolShape: 'document-symbol', decorators: 'at-line', leadingComments: true, readiness: { kind: 'progress', token: 'index' }, positionEncodings: ['utf-16'] },
  }] });
  return root;
}
async function analyze(root: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { return await Effect.runPromise(analyzeCode(repo).pipe(Effect.provide(OwnedProcessLive))); }
  finally { repo.close(); }
}
async function blocked(root: string) {
  rmSync(join(root, '.git/server-audit'), { force: true });
  rmSync(join(root, '.git/server-continue'), { force: true });
  const result = analyze(root);
  // Observe both outcomes immediately so a failed launch cannot escape cleanup.
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await pollUntil(async () => {
    if (existsSync(join(root, '.git/server-audit'))) return true;
    const early = await Promise.race([outcome, Promise.resolve(undefined)]);
    if (early && 'error' in early) throw early.error;
    return undefined;
  }, { description: 'external language server initialize request' });
  return { result, release: () => writeFileSync(join(root, '.git/server-continue'), 'continue') };
}
function clean(root: string): void {
  assert.equal(inspectRunner(root).status, 'absent');
  assert.equal(existsSync(join(tracePrivateDirectorySync(root), 'publication.lease')), false);
}

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
test('analysis releases persistent readers and publication ownership while its external server runs', async () => {
  const root = consumer();
  const running = await blocked(root);
  try {
    assert.equal(existsSync(join(tracePrivateDirectorySync(root), 'publication.lease')), false);
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: true });
    database.close();
    running.release();
    const result = await running.result;
    assert.deepEqual(result.observations.map(item => item.value.analyzer).sort(), ['fixture', 'typescript']);
    assert.deepEqual(result.observations.map(item => item.current), [true, true]);
    clean(root);
  } finally { running.release(); await running.result.catch(() => undefined); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
test('analysis refuses changed source, membership, contract, configuration and candidate bytes', async t => {
  const edits = [
    ['source', (root: string) => writeFileSync(join(root, 'src/sample.ts'), 'export const changed = 2;\n')],
    ['membership', (root: string) => writeFileSync(join(root, 'src/new-member.ts'), 'export const added = 1;\n')],
    ['contract', (root: string) => writeFileSync(join(root, target), readFileSync(join(root, target), 'utf8') + '\nChanged contract.\n')],
    ['configuration', (root: string) => writeFileSync(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8') + '\n// changed\n')],
    ['candidate', (root: string) => writeFileSync(join(root, 'candidate.txt'), 'new candidate member\n')],
  ] as const;
  for (const [name, edit] of edits) await t.test(name, async () => {
    const root = consumer(), running = await blocked(root);
    const rejected = assert.rejects(running.result, error => error instanceof ConcordError && error.code === 'AnalysisSourceChanged');
    try { edit(root); running.release(); await rejected; clean(root); }
    finally { running.release(); await running.result.catch(() => undefined); rmSync(root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @name native-analysis-publication-inputs
test('analysis refuses ignored adapter inputs changed while its external server runs', async () => {
  const root = consumer(), previous = process.env.ANALYSIS_ADAPTER_STATE;
  let running: Awaited<ReturnType<typeof blocked>> | undefined;
  try {
    mkdirSync(join(root, 'fixtures')); mkdirSync(join(root, 'test'));
    const state = join(root, 'fixtures/state'); writeFileSync(state, 'first');
    writeFileSync(join(root, '.gitignore'), 'fixtures/\n');
    writeFileSync(join(root, 'test/sample.py'), `# @use-case ${target}\n# @name selected\n# @native fixture:selected\ndef selected():\n    return 1\n`);
    buildSync({ entryPoints: ['test/fixtures/analysis-adapter.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'analysis-adapter.mjs'), logLevel: 'silent' });
    writeProjectConfig(root, { ...readProjectConfig(root), testAdapters: [{ id: 'fixture', include: ['test/sample.py'], argv: [process.execPath, 'analysis-adapter.mjs'], implementationFiles: ['analysis-adapter.mjs'], inputRoots: ['fixtures'], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['ANALYSIS_ADAPTER_STATE'] }] });
    process.env.ANALYSIS_ADAPTER_STATE = state;
    const repo = new LocalRepository(root);
    try { await Effect.runPromise(collectNativeTests(repo, ['test/sample.py']).pipe(Effect.provide(OwnedProcessLive))); } finally { repo.close(); }
    running = await blocked(root);
    const rejected = assert.rejects(running.result, error => error instanceof ConcordError && error.code === 'AnalysisSourceChanged');
    writeFileSync(state, 'changed'); running.release(); await rejected; clean(root);
  } finally {
    running?.release(); await running?.result.catch(() => undefined);
    if (previous === undefined) delete process.env.ANALYSIS_ADAPTER_STATE; else process.env.ANALYSIS_ADAPTER_STATE = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
