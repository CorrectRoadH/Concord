import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

const cli = resolve('dist/entry.js');
const ConfigView = Schema.Struct({ project: Schema.Record(Schema.String, Schema.Unknown), configDigest: Schema.String });
const run = (root: string, args: readonly string[], input = '', status = 0): string => {
  const output = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { input, encoding: 'utf8', timeout: 20_000 });
  assert.equal(output.status, status, JSON.stringify({ args, stdout: output.stdout, stderr: output.stderr, error: output.error }));
  return output.stdout || output.stderr;
};
const action = (root: string, value: unknown, status = 0): string => run(root, ['action', '--input', '-'], JSON.stringify(value), status);
const fileDigest = (root: string, path: string): string => `sha256:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}`;
const withConsumer = (name: string, body: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), `concord-independent-${name}-`));
  try { execFileSync('git', ['init', '-q', root]); body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};
const workspaceConfig = (root: string) => Schema.decodeUnknownSync(Schema.fromJsonString(ConfigView), { onExcessProperty: 'ignore' })(run(root, ['workspace', 'show']));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('snapshot recovery restores exact TypeScript bytes and keeps legacy authority separate', () => Effect.runPromise(Effect.sync(() => withConsumer('recovery', root => {
  action(root, { action: 'init', docsOnly: true, memorySources: [{ name: 'team', provider: 'local-files', path: 'team-memory', access: 'read-write', defaultWrite: true }] });
  const project = workspaceConfig(root).project;
  const configPath = 'concord.config.ts';
  const before = readFileSync(join(root, configPath), 'utf8');
  const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
  const journalPath = join(root, '.git/concord/journal.json');
  const entry = (path: string, old: string | null, next: string) => ({ path, before: old, after: next, beforeDigest: old === null ? null : hash(old), afterDigest: hash(next), mode: 420 });
  const journal = (operation: string, scope: unknown, changes: readonly unknown[]) => writeFileSync(journalPath, JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), projectId: project.projectId, operation, phase: 'prepared', directories: [], scope, changes }));
  const frozen = { kind: 'documents', configPath, configSource: before, configDigest: hash(before) };
  const after = `${before}\n// interrupted formatting edit\n`;
  writeFileSync(join(root, configPath), after);
  journal('set-config', frozen, [entry(configPath, before, after)]);
  run(root, ['recover']);
  assert.equal(readFileSync(join(root, configPath), 'utf8'), before);
  assert.equal(existsSync(journalPath), false);

  const memoryPath = 'team-memory/interrupted.md';
  writeFileSync(join(root, memoryPath), '# After\n');
  journal('memory', frozen, [entry(memoryPath, '# Before\n', '# After\n')]);
  run(root, ['recover']);
  assert.equal(readFileSync(join(root, memoryPath), 'utf8'), '# Before\n');

  writeFileSync(join(root, memoryPath), '# After\n');
  journal('legacy-memory', { kind: 'documents' }, [entry(memoryPath, '# Before\n', '# After\n')]);
  assert.match(run(root, ['recover'], '', 1), /InvalidData/);
  assert.equal(readFileSync(join(root, memoryPath), 'utf8'), '# After\n');
  assert.equal(existsSync(journalPath), true);
  rmSync(journalPath);

  journal('init', { kind: 'documents', configPath, configSource: '', configDigest: hash('') }, [entry(configPath, null, before), entry(memoryPath, null, '# After\n')]);
  run(root, ['recover']);
  assert.equal(existsSync(join(root, configPath)), false);
  assert.equal(existsSync(join(root, memoryPath)), false);
}))));

// @use-case docs/feature/project-onboarding/use-case/initialize-project.md
test('public init previews without writes and creates draft constitution with overridable combined defaults', () => Effect.runPromise(Effect.sync(() => withConsumer('defaults', root => {
  action(root, { action: 'init', docsOnly: true, projectTypes: ['library', 'cli'], design: false, dryRun: true });
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  assert.equal(existsSync(join(root, 'docs')), false);
  assert.equal(existsSync(join(root, '.git/concord')), false);
  action(root, { action: 'init', docsOnly: true, adoptConstitution: true, constitutionBody: '# Example\n\n```html\n<a id="c-example"></a>\n```\n', constitutionReason: 'Adopt', constitutionImpact: 'All features' }, 1);
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  action(root, { action: 'init', docsOnly: true, projectTypes: ['library', 'cli'], design: false });
  assert.equal(existsSync(join(root, 'concord.config.ts')), true);
  const agentInstructions = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(agentInstructions, /BEGIN CONCORD AGENT INSTRUCTIONS/);
  assert.match(agentInstructions, /concord --skill <topic>/);
  assert.match(agentInstructions, /docs\/constitution\.md/);
  assert.equal(existsSync(join(root, 'concord.json')), false);
  assert.equal(existsSync(join(root, 'DESIGN.md')), false);
  assert.match(readFileSync(join(root, 'docs/constitution.md'), 'utf8'), /status: draft/);
  action(root, { action: 'document.create', kind: 'feature', id: 'combined', title: 'Combined' });
  for (const page of ['README.md', 'library.md', 'cli.md']) assert.equal(existsSync(join(root, 'docs/feature/combined', page)), true);
  action(root, { action: 'document.create', kind: 'feature', id: 'minimal', title: 'Minimal', pages: [] });
  assert.equal(existsSync(join(root, 'docs/feature/minimal/README.md')), true);
  assert.equal(existsSync(join(root, 'docs/feature/minimal/library.md')), false);
  assert.equal(existsSync(join(root, 'docs/feature/minimal/cli.md')), false);
}))));

// @use-case docs/feature/project-onboarding/use-case/initialize-project.md
test('public init preserves existing AGENTS.md content and refuses incomplete managed markers atomically', () => Effect.runPromise(Effect.sync(() => {
  withConsumer('agent-rules-existing', root => {
    const existing = '# Repository rules\n\nKeep this exact text.\n';
    writeFileSync(join(root, 'AGENTS.md'), existing);
    run(root, ['init', '--docs-only']);
    const initialized = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.ok(initialized.startsWith(existing));
    assert.equal(initialized.match(/BEGIN CONCORD AGENT INSTRUCTIONS/g)?.length, 1);
    assert.match(initialized, /concord --skill/);
  });
  withConsumer('agent-rules-conflict', root => {
    const incomplete = '# Rules\n\n<!-- BEGIN CONCORD AGENT INSTRUCTIONS -->\nunknown edit\n';
    writeFileSync(join(root, 'AGENTS.md'), incomplete);
    run(root, ['init', '--docs-only'], '', 1);
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), incomplete);
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    assert.equal(existsSync(join(root, 'docs')), false);
  });
})));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('public configuration rejects executable TypeScript and stale edits without executing or overwriting them', () => Effect.runPromise(Effect.sync(() => withConsumer('config', root => {
  run(root, ['init', '--docs-only']);
  const path = join(root, 'concord.config.ts');
  const before = readFileSync(path, 'utf8');
  const snapshot = workspaceConfig(root);
  action(root, { action: 'config.set', config: { ...snapshot.project, memorySources: [
    { name: 'project', provider: 'local-files', path: 'memory', access: 'read-write', defaultWrite: true },
    { name: 'nested', provider: 'local-files', path: 'memory/nested', access: 'read-write' },
  ] }, expectedDigest: snapshot.configDigest }, 1);
  assert.equal(readFileSync(path, 'utf8'), before);
  const edited = `${before}\n// Human configuration note\n`;
  writeFileSync(path, edited);
  action(root, { action: 'config.set', config: snapshot.project, expectedDigest: snapshot.configDigest }, 1);
  assert.equal(readFileSync(path, 'utf8'), edited);
  writeFileSync(path, `${before}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(root, 'executed'))}, 'bad');\n`);
  run(root, ['doctor'], '', 1);
  assert.equal(existsSync(join(root, 'executed')), false);
  writeFileSync(path, before);
  writeFileSync(path, before.replace('export default {', 'export default { "__proto__": { "hidden": true },'));
  run(root, ['doctor'], '', 1);
  writeFileSync(path, before);
  writeFileSync(join(root, 'concord.json'), JSON.stringify(snapshot.project));
  run(root, ['doctor']);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(existsSync(join(root, 'concord.json')), true);
}))));

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
test('public constitution adoption requires clause IDs and amendment protects referenced IDs', () => Effect.runPromise(Effect.sync(() => withConsumer('constitution', root => {
  run(root, ['init', '--docs-only']);
  const path = 'docs/constitution.md';
  const draft = readFileSync(join(root, path), 'utf8');
  const adoption = { action: 'constitution.adopt', reason: 'Adopt project rules', impact: 'Applies to new features', sources: [], expectedDigest: fileDigest(root, path) };
  for (const example of [
    '```markdown\n## C-001 Example {#c-001}\n```',
    '<!--\n## C-001 Example {#c-001}\n-->',
    '`## C-001 Example {#c-001}`',
    '    ## C-001 Example {#c-001}',
  ]) assert.match(action(root, { ...adoption, body: `# Examples only\n\n${example}\n` }, 1), /InvalidConstitution/);
  for (const invalid of [
    '## C-001 Missing ID\n',
    '## C-001 Wrong label {#c-002}\n',
    '## C-1 Short {#c-1}\n',
    '## C-001 Rule {#c-001}\n\n1. Paragraph without ID.\n',
    '## C-001 Rule {#c-001}\n\n1. Foreign paragraph. {#c-002-1}\n',
    '## C-001 Rule {#c-001}\n\n1. First. {#c-001-a}\n2. Second. {#c-001-a}\n',
    '## C-001 Rule {#c-001}\n\n### c-001\n',
  ]) assert.match(action(root, { ...adoption, body: `# Constitution\n\n${invalid}` }, 1), /ConstitutionClauseInvalid/);
  assert.equal(readFileSync(join(root, path), 'utf8'), draft);
  const body = (paragraphs: string) => `# Constitution\n\n## C-001 Preserve user data {#c-001}\n\n${paragraphs}`;
  action(root, { ...adoption, body: body('1. Writes preserve unknown changes. {#c-001-1}\n2. Writes check preimages. {#c-001-2}\n') });
  const activeSource = readFileSync(join(root, path), 'utf8');
  assert.match(activeSource, /status: active/);
  assert.match(activeSource, /format: concord\.constitution\/v3/);
  assert.doesNotMatch(activeSource, /^version:|^\s+- version:/mu);
  const legacySource = activeSource.replace('status: active\n', 'status: active\nversion: 1.0.0\n');
  writeFileSync(join(root, path), legacySource);
  assert.match(run(root, ['constitution', 'show'], '', 1), /version/);
  assert.match(action(root, { action: 'constitution.amend', version: '2.0.0', body: activeSource, reason: 'Old call', impact: 'None', sources: [], expectedDigest: fileDigest(root, path) }, 1), /error|invalid|version/i);
  assert.equal(readFileSync(join(root, path), 'utf8'), legacySource);
  writeFileSync(join(root, path), activeSource);
  const retiredFlag = spawnSync(process.execPath, [cli, '--root', root, '--json', 'feature', 'create', 'governed', '--title', 'Governed', '--constitution-ref', 'docs/constitution.md#c-001'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(retiredFlag.status, 1);
  assert.match(retiredFlag.stderr, /"error":"InvalidInput".*--constitution-ref/u);
  assert.match(action(root, { action: 'document.create', kind: 'feature', id: 'governed', title: 'Governed', constitutionRefs: ['docs/constitution.md#c-001'] }, 1), /excess property[\s\S]*constitutionRefs/u);
  run(root, ['feature', 'create', 'governed', '--title', 'Governed']);
  const feature = 'docs/feature/governed/README.md';
  appendFileSync(join(root, feature), '\nWrites keep unknown edits ([C-001](../../constitution.md#c-001-1)).\n');
  const line = readFileSync(join(root, feature), 'utf8').split('\n').findIndex(text => text.includes('#c-001-1')) + 1;
  run(root, ['check']);
  const shown = JSON.parse(run(root, ['constitution', 'show'])) as { constitution: Record<string, unknown>; references: unknown; complete: boolean };
  assert.deepEqual(shown.constitution.clauses, [{ id: 'c-001', title: 'Preserve user data', paragraphs: ['c-001-1', 'c-001-2'] }]);
  assert.equal('anchors' in shown.constitution || 'affected' in shown, false);
  assert.deepEqual(shown.references, [{ path: feature, line, clause: 'c-001', paragraph: 'c-001-1' }]);
  assert.equal(shown.complete, true);
  assert.match(run(root, ['trace', 'show', feature]), /docs\/constitution\.md#c-001-1/);
  assert.match(run(root, ['review', 'render', feature]), /C-001 Preserve user data[\s\S]*c-001-1/);
  assert.match(action(root, { action: 'document.metadata', reference: feature, expectedDigest: fileDigest(root, feature), constitutionRefs: ['docs/constitution.md#c-001'] }, 1), /excess property[\s\S]*constitutionRefs/u);
  const amend = (next: string, status = 0) => action(root, { action: 'constitution.amend', body: next, reason: 'Revise rules', impact: 'Linked pages keep their IDs', sources: [], expectedDigest: fileDigest(root, path) }, status);
  amend(body('1. Writes are scoped. {#c-001-scope}\n2. Writes preserve unknown changes. {#c-001-1}\n3. Writes check preimages. {#c-001-2}\n'));
  run(root, ['check']);
  const before = readFileSync(join(root, path), 'utf8');
  const referenced = amend(body('1. Writes are scoped. {#c-001-scope}\n2. Writes check preimages. {#c-001-2}\n'), 1);
  assert.match(referenced, /ConstitutionClauseReferenced/);
  assert.match(referenced, /docs\/feature\/governed\/README\.md/);
  assert.equal(readFileSync(join(root, path), 'utf8'), before);
  amend(body('1. Writes are scoped; see [preimages](#c-001-2). {#c-001-scope}\n2. Writes preserve unknown changes. {#c-001-1}\n3. Writes check preimages. {#c-001-2}\n'));
  assert.match(amend(body('1. Writes are scoped; see [preimages](#c-001-2). {#c-001-scope}\n2. Writes preserve unknown changes. {#c-001-1}\n'), 1), /ConstitutionClauseReferenced/);
  const removal = body('1. Writes are scoped. {#c-001-scope}\n2. Writes preserve unknown changes. {#c-001-1}\n');
  const memories = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ memories: Schema.Array(Schema.Struct({ path: Schema.String, promotions: Schema.Array(Schema.String) })) })), { onExcessProperty: 'ignore' })(run(root, ['memory', 'list'])).memories;
  const constitutionBeforeRemoval = readFileSync(join(root, path), 'utf8');
  const promotionConflict = amend(removal, 1);
  assert.match(promotionConflict, /ConstitutionClauseReferenced/);
  assert.match(promotionConflict, /memory\/constitution-/);
  assert.equal(readFileSync(join(root, path), 'utf8'), constitutionBeforeRemoval);
  for (const memory of memories) if (memory.promotions.includes(`${path}#c-001-2`)) {
    run(root, ['memory', 'retire', memory.path, '--target', `${path}#c-001-2`, '--reason', 'The paragraph is being removed']);
  }
  amend(removal);
  assert.doesNotMatch(readFileSync(join(root, path), 'utf8'), /Adopt project rules|Revise rules/);
  run(root, ['check']);
}))));

// @use-case docs/feature/project-onboarding/use-case/configure-memory-sources.md
test('public Memory distinguishes duplicate short IDs and rejects indirect writes to a read-only source atomically', () => Effect.runPromise(Effect.sync(() => withConsumer('sources', root => {
  const sources = [
    { name: 'project', provider: 'local-files', path: 'memory', access: 'read-write', defaultWrite: true },
    { name: 'team', provider: 'local-files', path: 'team-memory', access: 'read-write' },
  ];
  mkdirSync(join(root, 'team-memory'));
  action(root, { action: 'init', docsOnly: true, memorySources: sources });
  for (const source of ['project', 'team']) run(root, ['memory', 'add', 'lesson', '--kind', 'decision', '--title', 'Lesson', '--source', source]);
  run(root, ['memory', 'show', 'lesson'], '', 1);
  run(root, ['memory', 'show', 'memory/lesson.md']);
  run(root, ['memory', 'show', 'team-memory/lesson.md']);
  run(root, ['roadmap', 'create', 'future', '--title', 'Future']);
  run(root, ['memory', 'promote', 'team-memory/lesson.md', '--target', 'docs/roadmap/future/README.md']);
  const snapshot = workspaceConfig(root);
  action(root, { action: 'config.set', config: { ...snapshot.project, memorySources: sources.map(source => source.name === 'team' ? { ...source, access: 'read-only' } : source) }, expectedDigest: snapshot.configDigest });
  const memoryBefore = readFileSync(join(root, 'team-memory/lesson.md'), 'utf8');
  const roadmapBefore = readFileSync(join(root, 'docs/roadmap/future/README.md'), 'utf8');
  run(root, ['roadmap', 'adopt', 'future', '--feature', 'delivered'], '', 1);
  assert.equal(existsSync(join(root, 'docs/feature/delivered')), false);
  assert.equal(readFileSync(join(root, 'team-memory/lesson.md'), 'utf8'), memoryBefore);
  assert.equal(readFileSync(join(root, 'docs/roadmap/future/README.md'), 'utf8'), roadmapBefore);
}))));
