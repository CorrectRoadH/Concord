import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository } from '../support/repository.ts';
import { parseTaste, tasteShow, inspectTaste } from '../../src/domain/taste/index.ts';
import { checkProject } from '../../src/app/index.ts';

const source = '# Taste\n\n## General {#general}\n\n1. Read first. {#general-read}\n\n## T-1 Keep one owner {#t-1}\n\nPrefer one source.\n\n## T-8 Read clearly {#t-8}\n';
const code = (name: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === name;
function fixture(run: (repo: LocalRepository, write: (path: string, body: string) => void) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'concord-taste-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root);
  const write = (path: string, body: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
  try { run(repo, write); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/taste/use-case/write-taste.md
test('taste uses current Markdown entries and general IDs without adoption state', () => {
  const record = parseTaste(source);
  assert.deepEqual(record.entries.map(entry => entry.id), ['general', 't-1', 't-8']);
  assert.deepEqual(record.entries[0]?.paragraphs, ['general-read']);
  assert.equal('metadata' in record, false);
  for (const body of [source.replace('{#t-1}', ''), source.replace('{#t-8}', '{#t-1}'), source.replace('{#t-8}', '{#t-9}'), source.replace('T-8', 'T-08').replace('t-8', 't-08'), `---\nstatus: active\n---\n${source}`]) assert.throws(() => parseTaste(body), code('TasteEntryInvalid'));
  assert.deepEqual(parseTaste('# Empty taste\n').entries, []);
  assert.equal(parseTaste(`${source}\n\`{#t-99}\`\n\n<!-- {#t-100} -->\n`).entries.length, 3);
});

// @use-case docs/feature/taste/use-case/cite-taste.md
test('taste derives ordered references from inline links and never writes', () => fixture((repo, write) => {
  write('docs/taste.md', source);
  write('docs/feature/cart/README.md', '# Cart\n\nUse [owner](../../taste.md#t-1) and [read](../../taste.md#general-read).\n');
  write('docs/_template/example.md', '[ignored](../taste.md#missing)\n');
  const result = tasteShow(repo);
  assert.equal(result.operation, 'taste');
  assert.deepEqual(result.references, [{ path: 'docs/feature/cart/README.md', line: 3, entry: 't-1' }, { path: 'docs/feature/cart/README.md', line: 3, entry: 'general-read' }]);
  assert.equal(repo.read('docs/taste.md'), source);
}));

// @use-case docs/feature/taste/use-case/remove-cited-entry.md
test('missing taste is advisory and removed entries fail Feature and Design pages', () => fixture((repo, write) => {
  assert.deepEqual(inspectTaste(repo).findings.map(finding => finding.code), ['TasteMissing']);
  const missing = checkProject(repo, 'off');
  assert.ok(!missing.findings.some(finding => finding.code === 'TasteMissing'));
  assert.ok(missing.advisories.some(finding => finding.code === 'TasteMissing'));
  write('docs/taste.md', `${source}\n## T-99 Shared rule {#t-99}\n\nKeep references valid.\n`);
  write('docs/design/store.md', '# Store\n\nUse [removed](../taste.md#t-99).\n');
  write('docs/feature/cart/README.md', '# Cart\n\nUse [removed](../../taste.md#t-99).\n');
  assert.equal(checkProject(repo, 'off').ok, true);
  write('docs/taste.md', source);
  const result = checkProject(repo, 'off');
  assert.deepEqual(result.findings.filter(finding => finding.code === 'AnchorNotFound').map(finding => [finding.path, finding.line]), [['docs/design/store.md', 3], ['docs/feature/cart/README.md', 3]]);
  write('docs/design/store.md', '# Store\n\nUse [owner](../taste.md#t-1).\n');
  write('docs/feature/cart/README.md', '# Cart\n\nUse [owner](../../taste.md#t-1).\n');
  assert.equal(checkProject(repo, 'off').ok, true);
  write('docs/feature/cart/README.md', '# Cart\n\nUse [invalid](../../taste.md?query#t-1).\n');
  assert.throws(() => tasteShow(repo), code('TasteLinkInvalid'));
}));
