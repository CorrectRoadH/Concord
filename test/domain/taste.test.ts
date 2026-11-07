import { Effect } from 'effect';
import { withConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { digest } from '../../src/model/index.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository } from '../support/repository.ts';
import { parseTaste, tasteShow, inspectTaste } from '../../src/domain/taste/index.ts';
import { checkProject, setMarkdown } from '../../src/app/index.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


const source = '# Taste\n\n## General {#general}\n\n1. Read first. {#general-read}\n\n## T-1 Keep one owner {#t-1}\n\nPrefer one source.\n\n## T-8 Read clearly {#t-8}\n';
const code = (name: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === name;
async function fixture(run: (repo: LocalRepository, write: (path: string, body: string) => void) => void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'concord-taste-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = (await LocalRepository.open(root));
  const write = (path: string, body: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
  try { await run(repo, write); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/taste/use-case/write-taste.md
test('taste uses current Markdown entries and general IDs without adoption state', () => {
  const record = parseTaste(source, parserRuntime);
  assert.deepEqual(record.entries.map(entry => entry.id), ['general', 't-1', 't-8']);
  assert.deepEqual(record.entries[0]?.paragraphs, ['general-read']);
  assert.equal('metadata' in record, false);
  for (const body of [source.replace('{#t-1}', ''), source.replace('{#t-8}', '{#t-1}'), source.replace('{#t-8}', '{#t-9}'), source.replace('T-8', 'T-08').replace('t-8', 't-08'), `---\nstatus: active\n---\n${source}`]) assert.throws(() => parseTaste(body, parserRuntime), code('TasteEntryInvalid'));
  assert.deepEqual(parseTaste('# Empty taste\n', parserRuntime).entries, []);
  assert.equal(parseTaste(`${source}\n\`{#t-99}\`\n\n<!-- {#t-100} -->\n`, parserRuntime).entries.length, 3);
});

// @use-case docs/feature/taste/use-case/cite-taste.md
test('taste derives ordered references from inline links and never writes', async () => (await fixture((repo, write) => {
  write('docs/taste.md', source);
  write('docs/feature/cart/README.md', '# Cart\n\nUse [owner](../../taste.md#t-1) and [read](../../taste.md#general-read).\n');
  write('docs/_template/example.md', '[ignored](../taste.md#missing)\n');
  const result = tasteShow(repo);
  assert.equal(result.operation, 'taste');
  assert.deepEqual(result.references, [{ path: 'docs/feature/cart/README.md', line: 3, entry: 't-1' }, { path: 'docs/feature/cart/README.md', line: 3, entry: 'general-read' }]);
  assert.equal(repo.read('docs/taste.md'), source);
})));

// @use-case docs/feature/taste/use-case/remove-cited-entry.md
test('missing taste is advisory and removed entries fail Feature and Design pages', async () => (await fixture(async (repo, write) => {
  assert.deepEqual(inspectTaste(repo).findings.map(finding => finding.code), ['TasteMissing']);
  const missing = (await checkProject(repo, 'off'));
  assert.ok(!missing.findings.some(finding => finding.code === 'TasteMissing'));
  assert.ok(missing.advisories.some(finding => finding.code === 'TasteMissing'));
  write('docs/taste.md', `${source}\n## T-99 Shared rule {#t-99}\n\nKeep references valid.\n`);
  write('docs/design/store.md', '# Store\n\nUse [removed](../taste.md#t-99).\n');
  write('docs/feature/cart/README.md', '# Cart\n\nUse [removed](../../taste.md#t-99).\n');
  assert.equal((await checkProject(repo, 'off')).ok, true);
  write('docs/taste.md', source);
  const result = (await checkProject(repo, 'off'));
  assert.deepEqual(result.findings.filter(finding => finding.code === 'AnchorNotFound').map(finding => [finding.path, finding.line]), [['docs/design/store.md', 3], ['docs/feature/cart/README.md', 3]]);
  write('docs/design/store.md', '# Store\n\nUse [owner](../taste.md#t-1).\n');
  write('docs/feature/cart/README.md', '# Cart\n\nUse [owner](../../taste.md#t-1).\n');
  assert.equal((await checkProject(repo, 'off')).ok, true);
  write('docs/feature/cart/README.md', '# Cart\n\nUse [invalid](../../taste.md?query#t-1).\n');
  assert.throws(() => tasteShow(repo), code('TasteLinkInvalid'));
})));

// @use-case docs/feature/taste/use-case/change-taste.md
test('editing a cited taste preserves its ID and immediately changes current results without side records', () => Effect.runPromise(Effect.tryPromise(async () => (await withConsumer(async (repo, root) => {
  const path = 'docs/taste.md';
  const initialized = readFileSync(join(root, path), 'utf8');
  (await setMarkdown(repo, path, source, digest(initialized)));
  const entry = tasteShow(repo).entries.find(entry => entry.kind === 'taste')!;
  (await createDocument(repo, 'feature', { id: 'cart', title: 'Cart', body: `# Cart\n\nUse [taste](../../taste.md#${entry.id}).\n` }));
  const before = repo.files('docs').sort();
  const updated = source.replace(entry.title, 'A revised project preference');
  (await setMarkdown(repo, path, updated, digest(source)));
  const result = tasteShow(repo);
  assert.equal(result.entries.find(candidate => candidate.id === entry.id)?.title, 'A revised project preference');
  assert.deepEqual(result.references, [{ path: 'docs/feature/cart/README.md', line: 3, entry: entry.id }]);
  assert.equal((await checkProject(repo, 'off')).ok, true);
  assert.equal(readFileSync(join(root, path), 'utf8'), updated);
  assert.deepEqual(repo.files('docs').sort(), before);
})))));
