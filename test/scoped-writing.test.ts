import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { renderTypeScriptConfig } from '../dist/config.js';
import { digest } from '../dist/shared.js';
import { catalogDependencies, indexConcepts, readConceptCatalog, setConcepts, showConcepts } from '../dist/concepts.js';
import { checkWriting } from '../dist/writing.js';
import { setWriting, showWriting, writingIndex } from '../dist/writing-management.js';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const policy = (extra: Record<string, unknown> = {}) => ({ format: 'concord.writing/v2' as const, bannedTerms: [], ...extra });
const concept = (id: string, names: Record<string, { preferred: string; aliases?: string[]; deprecated?: string[] }>) => ({ id, definition: `${id} meaning`, names });
const catalog = (concepts: ReturnType<typeof concept>[], imports?: string[]) => ({ format: 'concord.concepts/v1' as const, concepts, ...(imports ? { imports } : {}) });
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-scoped-writing-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
  rmSync(join(root, 'docs/concord-writing.json'));
  return root;
};
const withRepo = <T>(root: string, run: (repo: LocalRepository) => T, options = {}) => {
  const repo = new LocalRepository(root, options);
  try { return run(repo); } finally { repo.close(); }
};
const write = (root: string, path: string, source: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('project selection composes ancestor rules while explicit managed selection stays narrow', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    write(root, 'docs/feature/a/page.md', 'bad old Comment.\n');
    write(root, 'docs/feature/b/page.md', 'bad OldFeedback Comment.\n');
    withRepo(root, repo => setWriting(repo, { ...policy(), roots: ['docs/feature/a'], bannedTerms: [{ term: 'bad', use: 'good', why: 'global' }], unusedConcepts: true }, null));
    withRepo(root, repo => setWriting(repo, { ...policy(), bannedTerms: [{ term: 'old', use: 'new', why: 'local' }] }, null, false, 'docs/feature/a/concord-writing.json'));
    const b = catalog([concept('feedback', { en: { preferred: 'Feedback', aliases: ['Comment'], deprecated: ['OldFeedback'] }, api: { preferred: 'Feedback' } })]);
    withRepo(root, repo => setConcepts(repo, b, null, false, 'docs/feature/b/concepts.json'));
    withRepo(root, repo => setConcepts(repo, catalog([], ['docs/feature/b/concepts.json#feedback']), null, false, 'docs/feature/a/concepts.json'));
    const scopes = withRepo(root, writingIndex).scopes;
    assert(scopes.some(item => item.scope === 'docs/feature/b' && item.hasCatalog && !item.hasPolicy));
    const project = withRepo(root, checkWriting);
    assert.deepEqual(project.selectedRoots, ['docs/feature/a', 'docs/feature/b']);
    assert(project.findings.some(item => item.file === 'docs/feature/b/page.md' && item.message.includes('bad')));
    assert(project.findings.some(item => item.file === 'docs/feature/a/page.md' && item.message.includes('old')));
    assert(project.findings.some(item => item.file === 'docs/feature/b/page.md' && item.message.includes('OldFeedback')));
    assert(!project.findings.some(item => item.rule === 'unusedConcept'));
    const narrow = withRepo(root, repo => checkWriting(repo, 'docs/concord-writing.json'));
    assert.equal(narrow.mode, 'managed');
    assert.deepEqual(narrow.selectedRoots, ['docs/feature/a']);
    assert(!narrow.findings.some(item => item.file === 'docs/feature/b/page.md'));
    assert.deepEqual(withRepo(root, indexConcepts).concepts.map(item => item.reference), ['docs/feature/b/concepts.json#feedback']);
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
    withRepo(root, repo => setWriting(repo, { ...policy(), roots: ['apps/docs-site/zh', 'docs/feature/a', 'docs/feature/b'] }, null));
    withRepo(root, repo => setConcepts(repo, catalog([]), null, false, 'docs/feature/a/concepts.json'));
    withRepo(root, repo => setConcepts(repo, catalog([]), null, false, 'docs/feature/b/concepts.json'));
    const report = withRepo(root, checkWriting);
    assert.equal(report.files, 3);
    assert.equal(report.findings.length, 0);
    write(root, 'docs/feature/a/figure.svg', '<svg>changed</svg>');
    write(root, 'docs/feature/a/another.svg', '<svg/>');
    write(root, 'docs/feature/a/style.css', 'changed');
    assert.equal(withRepo(root, checkWriting).inputDigest, report.inputDigest);
    write(root, 'only-svg/figure.svg', '<svg/>');
    write(root, 'standalone.json', json(policy({ roots: ['only-svg'] })));
    assert.throws(() => withRepo(root, repo => checkWriting(repo, 'standalone.json')), /No Markdown or MDX files/);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('standalone explicit profile works without managed owners and ignores unrelated v1 policy semantics', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    rmSync(join(root, 'docs/concepts.json'));
    write(root, 'guide/page.md', 'bad.\n');
    write(root, 'standalone.json', json({ ...policy(), roots: ['guide'], bannedTerms: [{ term: 'bad', use: 'good', why: 'standalone' }] }));
    assert.throws(() => withRepo(root, checkWriting), { code: 'WritingPolicyNotFound' });
    const first = withRepo(root, repo => checkWriting(repo, 'standalone.json'));
    assert.equal(first.mode, 'standalone');
    assert.equal(first.findings.filter(item => item.rule === 'bannedTerm').length, 1);
    write(root, 'docs/concord-writing.json', json({ format: 'concord.writing/v1', roots: ['docs'], bannedTerms: [] }));
    assert.throws(() => withRepo(root, checkWriting), { code: 'WritingMigrationRequired' });
    const second = withRepo(root, repo => checkWriting(repo, 'standalone.json'));
    assert.equal(second.mode, 'standalone');
    assert.equal(second.findings.filter(item => item.rule === 'bannedTerm').length, 1);
    assert.notEqual(first.inputDigest, second.inputDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('same-concept cross-language active spelling is accepted; active/deprecated overlap is rejected', () => Effect.runPromise(Effect.sync(() => {
  const valid = catalog([concept('feedback', { en: { preferred: 'Feedback', aliases: ['Comment'] }, api: { preferred: 'Feedback' } })]);
  assert.equal(readConceptCatalog(json(valid)).concepts.length, 1);
  assert.throws(() => readConceptCatalog(json(catalog([concept('feedback', { en: { preferred: 'Feedback' }, api: { preferred: 'API', deprecated: ['Feedback'] } })]))), { code: 'InvalidConceptCatalog' });
  assert.throws(() => readConceptCatalog(json(catalog([concept('feedback', { en: { preferred: 'Feedback', aliases: ['feedback'] } })]))), { code: 'InvalidConceptCatalog' });
  assert.throws(() => readConceptCatalog(json(catalog([concept('feedback', { en: { preferred: 'Feedback', deprecated: ['Old'] }, api: { preferred: 'API', deprecated: ['Old'] } })]))), { code: 'InvalidConceptCatalog' });
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('missing and invalid local catalog show inherited and direct-import projections without blocking repair', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), path = 'docs/feature/a/nested/concepts.json';
  try {
    const globalShow = withRepo(root, showConcepts);
    withRepo(root, repo => setConcepts(repo, catalog([concept('global', { en: { preferred: 'Global' } })]), globalShow.digest));
    withRepo(root, repo => setConcepts(repo, catalog([concept('shared', { en: { preferred: 'Shared' } })]), null, false, 'docs/feature/b/concepts.json'));
    withRepo(root, repo => setConcepts(repo, catalog([concept('local', { en: { preferred: 'Local' } })], ['docs/feature/b/concepts.json#shared']), null, false, 'docs/feature/a/concepts.json'));
    const missing = withRepo(root, repo => showConcepts(repo, path));
    assert.equal(missing.state, 'missing');
    assert.deepEqual(missing.effectiveConcepts.map(item => item.reference).sort(), ['docs/concepts.json#global', 'docs/feature/a/concepts.json#local', 'docs/feature/b/concepts.json#shared'].sort());
    write(root, path, '{ broken');
    write(root, 'docs/feature/other/concepts.json', '{ unrelated broken');
    const invalid = withRepo(root, repo => showConcepts(repo, path));
    assert.equal(invalid.state, 'invalid');
    assert.equal(invalid.source, '{ broken');
    assert.equal(invalid.effectiveConcepts.length, 3);
    assert(invalid.diagnostics.some(item => item.sources.includes(path)));
    assert(invalid.diagnostics.some(item => item.sources.includes('docs/feature/other/concepts.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('overlapping effective concepts expose ambiguity and actual term conflicts with both sources', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    write(root, 'docs/feature/a/page.md', 'Label appears.\n');
    write(root, 'docs/feature/b/page.md', 'Label appears.\n');
    withRepo(root, repo => setWriting(repo, { ...policy(), roots: ['docs/feature/a', 'docs/feature/b'] }, null));
    const global = catalog([concept('global-label', { en: { preferred: 'Label' } })]);
    const local = catalog([concept('local-label', { en: { preferred: 'Label' } })]);
    const globalShow = withRepo(root, showConcepts);
    withRepo(root, repo => setConcepts(repo, global, globalShow.digest));
    withRepo(root, repo => setConcepts(repo, local, null, false, 'docs/feature/a/concepts.json'));
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
test('catalog publication protects imports, malformed dependency uncertainty, CAS and dry-run', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), target = 'docs/feature/a/concepts.json', importer = 'docs/feature/b/concepts.json';
  try {
    const original = catalog([concept('item', { en: { preferred: 'Item' } })]);
    const created = withRepo(root, repo => setConcepts(repo, original, null, false, target));
    write(root, importer, '{ broken');
    assert.throws(() => withRepo(root, repo => setConcepts(repo, catalog([]), created.digest, false, target)), { code: 'ConceptReferencesUnknown' });
    const additive = withRepo(root, repo => setConcepts(repo, catalog([...original.concepts, concept('extra', { en: { preferred: 'Extra' } })]), created.digest, true, target));
    assert.equal(additive.dryRun, true);
    assert.equal(readFileSync(join(root, target), 'utf8'), created.source);
    write(root, importer, json(catalog([], [`${target}#item`])));
    assert.throws(() => withRepo(root, repo => setConcepts(repo, catalog([]), created.digest, false, target)), { code: 'ConceptInUse' });
    assert.throws(() => withRepo(root, repo => setConcepts(repo, original, null, false, target)), { code: 'PreimageChanged' });
    write(root, target, '{ invalid owner');
    const repair = withRepo(root, repo => setConcepts(repo, original, digest('{ invalid owner'), false, target));
    assert.equal(repair.catalog.concepts.length, 1);
    assert.equal(withRepo(root, repo => showConcepts(repo, target)).state, 'valid');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('init creates only the exact empty global catalog and preserves a pre-existing invalid owner', () => Effect.runPromise(Effect.sync(() => {
  const fresh = fixture();
  try {
    assert.equal(readFileSync(join(fresh, 'docs/concepts.json'), 'utf8'), '{\n  "format": "concord.concepts/v1",\n  "concepts": []\n}\n');
    assert.throws(() => withRepo(fresh, repo => repo.publish('set-markdown', [{ path: 'docs/concepts.json', before: repo.read('docs/concepts.json')!, after: json(catalog([])) }])), { code: 'InvalidChange' });
  } finally { rmSync(fresh, { recursive: true, force: true }); }
  const root = mkdtempSync(join(tmpdir(), 'concord-init-existing-catalog-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    write(root, 'docs/concepts.json', '{ broken');
    const repo = new LocalRepository(root, { initialize: true });
    try {
      const receipt = initialize(repo, false, { testRoots: [] });
      assert(receipt.preservedPaths.includes('docs/concepts.json'));
      assert(!receipt.createdPaths.includes('docs/concepts.json'));
    } finally { repo.close(); }
    assert.equal(readFileSync(join(root, 'docs/concepts.json'), 'utf8'), '{ broken');
  } finally { rmSync(root, { recursive: true, force: true }); }
  const forgedRoot = mkdtempSync(join(tmpdir(), 'concord-init-forged-catalog-'));
  try {
    execFileSync('git', ['init', '-q', forgedRoot]);
    const initial = new LocalRepository(forgedRoot, { initialize: true, dryRun: true });
    const preview = (() => { try { return initialize(initial, true, { testRoots: [] }); } finally { initial.close(); } })();
    const configSource = renderTypeScriptConfig(preview.config);
    const after = json(catalog([concept('forged', { en: { preferred: 'Forged' } })]));
    const journalPath = join(forgedRoot, '.git/concord/journal.json');
    mkdirSync(join(forgedRoot, '.git/concord'), { recursive: true });
    writeFileSync(journalPath, json({ format: 'concord.journal', root: forgedRoot, privateDir: join(forgedRoot, '.git/concord'), projectId: preview.config.projectId, operation: 'init', phase: 'prepared', directories: ['docs'], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') }, changes: [
      { path: 'concord.config.ts', before: null, after: configSource, beforeDigest: null, afterDigest: digest(configSource), mode: 0o644 },
      { path: 'docs/concepts.json', before: null, after, beforeDigest: null, afterDigest: digest(after), mode: 0o644 },
    ] }));
    assert.throws(() => new LocalRepository(forgedRoot, { recover: true }), { code: 'RecoveryConflict' });
    assert.equal(existsSync(journalPath), true);
    assert.equal(existsSync(join(forgedRoot, 'docs/concepts.json')), false);
  } finally { rmSync(forgedRoot, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('persisted catalog dependency guard rejects forged membership and changed importers during recovery', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), target = 'docs/feature/a/concepts.json', importer = 'docs/feature/b/concepts.json';
  const journalPath = join(root, '.git/concord/journal.json');
  try {
    const before = '{ broken', after = json(catalog([concept('item', { en: { preferred: 'Item' } })]));
    write(root, target, before);
    write(root, importer, json(catalog([], [`${target}#item`])));
    const config = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    const projectId = withRepo(root, repo => repo.config.projectId);
    const deps = withRepo(root, repo => catalogDependencies(repo, target));
    const base = { format: 'concord.journal', root, privateDir: join(root, '.git/concord'), projectId, operation: 'set-concepts', phase: 'prepared', directories: [], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: config, configDigest: digest(config) }, changes: [{ path: target, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 }], catalogDependencies: deps };
    writeFileSync(journalPath, json({ ...base, catalogDependencies: deps.filter(item => item.path !== importer) }));
    assert.throws(() => new LocalRepository(root, { recover: true }), { code: 'RecoveryConflict' });
    rmSync(journalPath);
    writeFileSync(journalPath, json(base));
    write(root, importer, json(catalog([], [])));
    assert.throws(() => new LocalRepository(root, { recover: true }), { code: 'RecoveryConflict' });
    rmSync(journalPath);
    write(root, importer, json(catalog([], [`${target}#item`])));
    writeFileSync(journalPath, json(base));
    write(root, 'docs/feature/c/concepts.json', json(catalog([])));
    assert.throws(() => new LocalRepository(root, { recover: true }), { code: 'RecoveryConflict' });
    rmSync(journalPath);
    rmSync(join(root, 'docs/feature/c/concepts.json'));
    writeFileSync(journalPath, json(base));
    rmSync(join(root, importer));
    assert.throws(() => new LocalRepository(root, { recover: true }), { code: 'RecoveryConflict' });
    rmSync(journalPath);
    write(root, importer, json(catalog([], [`${target}#item`])));
    write(root, target, after);
    writeFileSync(journalPath, json(base));
    assert.equal(withRepo(root, repo => repo.recover(), { recover: true }).status, 'rolled-back');
    assert.equal(readFileSync(join(root, target), 'utf8'), before);
    write(root, target, after);
    writeFileSync(journalPath, json({ ...base, phase: 'committed' }));
    assert.equal(withRepo(root, repo => repo.recover(), { recover: true }).status, 'committed');
    assert.equal(readFileSync(join(root, target), 'utf8'), after);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('explicit v1 migration uses public CLI catalog then policy CAS; old prose remains unchanged', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), cli = join(process.cwd(), 'dist/entry.js');
  try {
    const old = json({ format: 'concord.writing/v1', roots: ['docs'], bannedTerms: [], concepts: 'docs/concepts.md' });
    write(root, 'docs/concord-writing.json', old);
    const prose = '# Existing explanation\n\nThe old table is historical prose.\n';
    write(root, 'docs/concepts.md', prose);
    const call = (...args: string[]) => spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 15_000 });
    const oldShow = JSON.parse(call('writing', 'show').stdout) as { state: string; digest: string; source: string };
    assert.equal(oldShow.state, 'invalid');
    assert.equal(oldShow.source, old);
    assert.match(call('docs', 'check').stderr, /WritingMigrationRequired/u);
    const catalogBody = join(root, 'catalog.json'), policyBody = join(root, 'policy.json');
    writeFileSync(catalogBody, json(catalog([concept('term', { en: { preferred: 'Term' } })])));
    writeFileSync(policyBody, json(policy()));
    const catalogShow = JSON.parse(call('concepts', 'show').stdout) as { digest: string };
    assert.equal(call('concepts', 'set', '--body', catalogBody, '--expected-digest', catalogShow.digest).status, 0);
    assert.equal(call('writing', 'set', '--body', policyBody, '--expected-digest', oldShow.digest).status, 0);
    assert.equal(call('docs', 'check').status, 0);
    assert.equal(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), prose);
    assert.equal(existsSync(join(root, 'docs/concepts.json')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
