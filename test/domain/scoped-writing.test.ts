import { writeProjectConfig } from '../support/support.ts';
import { createConsumer } from '../support/consumer.ts';
import { writeConceptFile, writeWritingFile } from '../support/writing-files.ts';
import { initialize } from '../support/operations.ts';
import { EMPTY_CONCEPT_CATALOG } from "../../src/model/index.ts";
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { renderTypeScriptConfig } from "../../src/base/workspace/index.ts";
import { digest } from "../../src/model/index.ts";
import { indexConcepts, readConceptCatalog, showConcepts } from "../../src/domain/concepts/index.ts";
import { checkWriting } from "../../src/domain/writing/index.ts";
import { writingIndex } from "../../src/domain/writing/index.ts";

const json = (value: unknown): string => typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
const policy = (extra: Record<string, unknown> = {}) => ({ bannedTerms: [], ...extra });
const concept = (id: string, term: string, deprecated: string[] = []) => ({ id, term, definition: `${id} meaning`, deprecated });
const catalog = (concepts: ReturnType<typeof concept>[]) => `# Terms\n${concepts.map(item => `\n## ${item.term} {#${item.id}}\n\n${item.definition}\n${item.deprecated.length ? `\n旧写法：${item.deprecated.map(word => `\`${word}\``).join('、')}\n` : ''}`).join('')}`;
const fixture = () => {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [] });
  rmSync(join(root, 'docs/writing.md'));
  return root;
};
const withRepo = <T>(root: string, run: (repo: LocalRepository) => T, options = {}) => {
  const repo = new LocalRepository(root, options);
  try { return run(repo); } finally { repo.close(); }
};
const write = (root: string, path: string, source: string) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), source); };

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('project selection composes ancestor rules while explicit managed selection stays narrow', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    write(root, 'docs/feature/a/page.md', 'bad old Feedback.\n');
    write(root, 'docs/feature/b/page.md', 'bad OldFeedback Feedback.\n');
    withRepo(root, repo => writeWritingFile(repo, { ...policy(), roots: ['docs/feature/a', 'docs/feature/b'], bannedTerms: [{ term: 'bad', use: 'good', why: 'global' }], }, null));
    withRepo(root, repo => writeWritingFile(repo, { ...policy(), bannedTerms: [{ term: 'old', use: 'new', why: 'local' }] }, null, false, 'docs/feature/a/writing.md'));
    const b = catalog([concept('feedback', 'Feedback', ['OldFeedback'])]);
    withRepo(root, repo => writeConceptFile(repo, b, null, false, 'docs/feature/b/concepts.md'));
    withRepo(root, repo => writeConceptFile(repo, catalog([]), null, false, 'docs/feature/a/concepts.md'));
    const scopes = withRepo(root, writingIndex).scopes;
    assert(scopes.some(item => item.scope === 'docs/feature/b' && item.hasCatalog && !item.hasPolicy));
    const project = withRepo(root, checkWriting);
    assert.deepEqual(project.selectedRoots, ['docs/feature/a', 'docs/feature/b']);
    assert(project.findings.some(item => item.file === 'docs/feature/b/page.md' && item.message.includes('bad')));
    assert(project.findings.some(item => item.file === 'docs/feature/a/page.md' && item.message.includes('old')));
    assert(project.findings.some(item => item.file === 'docs/feature/b/page.md' && item.message.includes('OldFeedback')));
    assert(!project.findings.some(item => item.rule === 'unusedConcept'));
    const narrow = withRepo(root, repo => checkWriting(repo, 'docs/feature/a/writing.md'));
    assert.equal(narrow.mode, 'managed');
    assert.deepEqual(narrow.selectedRoots, ['docs/feature/a']);
    assert(!narrow.findings.some(item => item.file === 'docs/feature/b/page.md'));
    assert.deepEqual(withRepo(root, indexConcepts).concepts.map(item => item.reference), ['docs/feature/b/concepts.md#feedback']);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('writing snapshots exclude SVG and CSS content and membership', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    write(root, 'apps/docs-site/zh/page.md', '外部词说明。\n');
    write(root, 'apps/docs-site/zh/figure.svg', '<svg><text class="label">外部词</text></svg>');
    write(root, 'docs/feature/a/page.md', '甲词说明。\n');
    write(root, 'docs/feature/a/figure.svg', '<svg><text class="label">乙词</text></svg>');
    write(root, 'docs/feature/b/page.md', '乙词说明。\n');
    withRepo(root, repo => writeWritingFile(repo, { ...policy(), roots: ['apps/docs-site/zh', 'docs/feature/a', 'docs/feature/b'] }, null));
    withRepo(root, repo => writeConceptFile(repo, catalog([]), null, false, 'docs/feature/a/concepts.md'));
    withRepo(root, repo => writeConceptFile(repo, catalog([]), null, false, 'docs/feature/b/concepts.md'));
    const report = withRepo(root, checkWriting);
    assert.equal(report.files, 5);
    assert.equal(report.findings.length, 0);
    write(root, 'docs/feature/a/figure.svg', '<svg>changed</svg>');
    write(root, 'docs/feature/a/another.svg', '<svg/>');
    write(root, 'docs/feature/a/style.css', 'changed');
    assert.equal(withRepo(root, checkWriting).inputDigest, report.inputDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('single spelling and deprecated uniqueness use the same normalization', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(readConceptCatalog(catalog([concept('feedback', 'Feedback')])).concepts.length, 1);
  for (const source of [catalog([concept('feedback', 'Feedback', ['feedback'])]), catalog([concept('a', 'Feedback'), concept('b', 'feedback')]), catalog([concept('a', 'Alpha', ['Old']), concept('b', 'Beta', ['old'])])]) assert.throws(() => readConceptCatalog(source), { code: 'InvalidConceptCatalog' });
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('missing and invalid local catalog show inherited projections without blocking repair', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), path = 'docs/feature/a/nested/concepts.md';
  try {
    const globalShow = withRepo(root, showConcepts);
    withRepo(root, repo => writeConceptFile(repo, catalog([concept('global', 'Global')]), globalShow.digest));
    withRepo(root, repo => writeConceptFile(repo, catalog([concept('shared', 'Shared')]), null, false, 'docs/feature/b/concepts.md'));
    withRepo(root, repo => writeConceptFile(repo, catalog([concept('local', 'Local')]), null, false, 'docs/feature/a/concepts.md'));
    const missing = withRepo(root, repo => showConcepts(repo, path));
    assert.equal(missing.state, 'missing');
    assert.deepEqual(missing.effectiveConcepts.map(item => item.reference).sort(), ['docs/concepts.md#global', 'docs/feature/a/concepts.md#local'].sort());
    write(root, path, '{ broken');
    write(root, 'docs/feature/other/concepts.md', '{ unrelated broken');
    const invalid = withRepo(root, repo => showConcepts(repo, path));
    assert.equal(invalid.state, 'invalid');
    assert.equal(invalid.source, '{ broken');
    assert.equal(invalid.effectiveConcepts.length, 2);
    assert(invalid.diagnostics.some(item => item.sources.includes(path)));
    assert(invalid.diagnostics.some(item => item.sources.includes('docs/feature/other/concepts.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('overlapping effective concepts expose ambiguity and actual term conflicts with both sources', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    write(root, 'docs/feature/a/page.md', 'Label appears.\n');
    write(root, 'docs/feature/b/page.md', 'Label appears.\n');
    withRepo(root, repo => writeWritingFile(repo, { ...policy(), roots: ['docs/feature/a', 'docs/feature/b'] }, null));
    const global = catalog([concept('global-label', 'Label')]);
    const local = catalog([concept('local-label', 'Label')]);
    const globalShow = withRepo(root, showConcepts);
    withRepo(root, repo => writeConceptFile(repo, global, globalShow.digest));
    withRepo(root, repo => writeConceptFile(repo, local, null, false, 'docs/feature/a/concepts.md'));
    const index = withRepo(root, indexConcepts);
    const ambiguity = index.diagnostics.find(item => item.code === 'AmbiguousConceptName');
    assert.equal(ambiguity?.scope, 'docs/feature/a');
    assert.equal(ambiguity?.sources.length, 2);
    const report = withRepo(root, checkWriting);
    const conflict = report.findings.find(item => item.file === 'docs/feature/a/page.md' && item.rule === 'writingConflict');
    assert.equal(conflict?.sources?.length, 2);
    assert(!report.findings.some(item => item.file === 'docs/feature/b/page.md' && item.rule === 'writingConflict'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('init creates only the exact empty global catalog and preserves a pre-existing invalid owner', () => Effect.runPromise(Effect.sync(() => {
  const fresh = fixture();
  try {
    assert.equal(readFileSync(join(fresh, 'docs/concepts.md'), 'utf8'), EMPTY_CONCEPT_CATALOG);
    withRepo(fresh, repo => repo.publish('set-markdown', [{ path: 'docs/concepts.md', before: repo.read('docs/concepts.md')!, after: json(catalog([])) }]));
    assert.equal(readFileSync(join(fresh, 'docs/concepts.md'), 'utf8'), json(catalog([])));
  } finally { rmSync(fresh, { recursive: true, force: true }); }
  // Initial catalogs and initialization recovery are the inputs under test, before any template exists.
  const root = mkdtempSync(join(tmpdir(), 'concord-init-existing-catalog-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    write(root, 'docs/concepts.md', '{ broken');
    const repo = new LocalRepository(root, { initialize: true });
    try {
      const receipt = initialize(repo, false, { testRoots: [] });
      assert(receipt.preservedPaths.includes('docs/concepts.md'));
      assert(!receipt.createdPaths.includes('docs/concepts.md'));
    } finally { repo.close(); }
    assert.equal(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), '{ broken');
  } finally { rmSync(root, { recursive: true, force: true }); }
  const forgedRoot = mkdtempSync(join(tmpdir(), 'concord-init-forged-catalog-'));
  try {
    execFileSync('git', ['init', '-q', forgedRoot]);
    const initial = new LocalRepository(forgedRoot, { initialize: true, dryRun: true });
    const preview = (() => { try { return initialize(initial, true, { testRoots: [] }); } finally { initial.close(); } })();
    const configSource = renderTypeScriptConfig(preview.config);
    const after = json(catalog([concept('forged', 'Forged')]));
    const journalPath = join(forgedRoot, '.git/concord/journal.json');
    mkdirSync(join(forgedRoot, '.git/concord'), { recursive: true });
    writeFileSync(journalPath, json({ format: 'concord.journal', root: forgedRoot, privateDir: join(forgedRoot, '.git/concord'), operation: 'init', phase: 'prepared', directories: ['docs'], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') }, changes: [
      { path: 'concord.config.ts', before: null, after: configSource, beforeDigest: null, afterDigest: digest(configSource), mode: 0o644 },
      { path: 'docs/concepts.md', before: null, after, beforeDigest: null, afterDigest: digest(after), mode: 0o644 },
    ] }));
    assert.throws(() => new LocalRepository(forgedRoot, { recover: true }), { code: 'RecoveryConflict' });
    assert.equal(existsSync(journalPath), true);
    assert.equal(existsSync(join(forgedRoot, 'docs/concepts.md')), false);
  } finally { rmSync(forgedRoot, { recursive: true, force: true }); }
})));
