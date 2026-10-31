import { createDocument, initialize } from '../support/operations.js';
import { packageBin } from '../../scripts/package-location.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { installConcord, packConcord } from '../support/installed-package.js';
import { Effect, Schema } from 'effect';
import { extractSteps } from "../../src/domain/documents/index.js";
import { formatUseCase, renameUseCaseStep, useCaseSteps } from "../../src/app/index.js";
import { planStepRename } from "../../src/app/index.js";
import { loadDocuments } from "../../src/domain/documents/index.js";

import { renderDocument } from "../../src/model/index.js";
import { LocalRepository } from "../support/repository.js";

import { buildTrace } from "../../src/domain/trace/index.js";
import { renderReview, traceGaps, traceShow } from "../../src/app/index.js";
import { clearCache, parseTestDeclarations } from "../../src/domain/tests/index.js";
import { digest } from "../../src/model/index.js";
import { genericPrivateDirectorySync } from "../../src/base/publication/index.js";
import { checkWriting } from "../../src/domain/writing/index.js";
import { runCase } from "../../src/domain/tests/index.js";
import { OwnedProcess, type OwnedProcessResult } from "../../src/base/process/index.js";

const path = 'docs/feature/sample/use-case/flow.md';
const packedRoot = mkdtempSync(join(tmpdir(), 'concord-steps-packed-'));
let entry: string;
before(() => { const install = join(packedRoot, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true })); installConcord(install, packConcord(packedRoot)); entry = packageBin(join(install, 'node_modules/concord-sdlc')); });
after(() => rmSync(packedRoot, { recursive: true, force: true }));
function document(body: string, kind: 'use-case' | 'feature' = 'use-case') {
  return renderDocument(kind === 'use-case' ? { format: 'concord.document/v1', kind, id: 'flow', title: 'Flow', feature: 'docs/feature/sample/README.md' } : { format: 'concord.document/v1', kind, id: 'sample', title: 'Sample' }, body);
}
function consumer(run: (repo: LocalRepository, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-steps-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    repo = new LocalRepository(root, { initialize: true });
    initialize(repo, false, { sourceRoots: ['src'], testRoots: ['test'] });
    createDocument(repo, 'feature', { id: 'sample', title: 'Sample', pages: [] });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample' });
    for (const dir of ['src', 'test']) mkdirSync(join(root, dir));
    run(repo, root);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
}
function write(root: string, file: string, source: string) { mkdirSync(resolve(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), source); }
function cli(root: string, args: readonly string[], status = 0) {
  const result = spawnSync(process.execPath, [entry, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return JSON.parse(result.stdout || result.stderr) as unknown;
}

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#declare-steps
// @name steps-ast-and-namespace
test('steps C1 C3 C4 C10 C11 C12 use AST positions, exact Unicode IDs and one heading namespace', () => Effect.runPromise(Effect.sync(() => {
  const source = document('# Flow\n\n## 流程\n\n7. First 😀  {#拒绝令牌}\n8. Second\n   continuation {#second}\n\n## Acceptance\n\n1. Ordinary\n\n```md\n1. fake {#fence}\n```\n\n1. `example {#inline}`\n\n<div>\n1. fake {#html}\n</div>\n');
  const result = extractSteps(path, source);
  assert.deepEqual(result.steps.map(step => [step.id, step.ordinal, step.listOrdinal]), [['拒绝令牌', 1, 1], ['second', 2, 1]]);
  assert.deepEqual(result.findings, []);
  for (const marker of result.markers) assert.match(source.split('\n')[marker.line - 1]!.slice(marker.startColumn, marker.endColumn), /^ +\{#[^}]+\}$/u);
  assert.ok(result.steps[1]!.endLine > result.steps[1]!.line);
  assert.deepEqual(extractSteps(path, document('# Flow\n\n1. New unmarked\n2. Second {#second}\n3. First {#拒绝令牌}\n')).steps.map(step => [step.id, step.ordinal]), [['second', 1], ['拒绝令牌', 2]]);
  for (const body of ['## foo--bar\n\n1. Item {#foo-bar}\n', '## Title {#custom}\n\n1. Item {#custom}\n', '## Title {#custom} ###\n\n1. Item {#title}\n', '1. One {#same}\n2. Two {#same}\n']) assert.equal(extractSteps(path, document(body)).findings[0]?.code, 'DuplicateAnchor');
  assert.deepEqual(extractSteps(path, document('1. Text <span>sample {#inside}\n')).steps, []);
  assert.equal(extractSteps(path, document('1. Text <span>sample</span> {#outside}\n')).steps[0]?.id, 'outside');
  assert.deepEqual(extractSteps(path, document('1. A {#é}\n2. B {#é}\n3. C {#É}\n')).findings, []);
  for (const body of ['- Wrong {#bad}\n', '1. Parent\n   1. Nested {#bad}\n', 'Paragraph {#bad}\n', '1. Bad {#two--parts}\n']) assert.equal(extractSteps(path, document(body)).findings[0]?.code, 'InvalidStepPosition');
  assert.equal(extractSteps('docs/feature/sample/README.md', document('1. Wrong {#bad}\n', 'feature')).findings[0]?.code, 'InvalidStepPosition');
  assert.equal(extractSteps('docs/feature/sample/cli.md', '1. Wrong {#bad}\n').findings[0]?.code, 'InvalidStepPosition');
})));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#inspect-associations
// @name steps-trace-and-static-gate
test('steps C2 C5 C9 C13 C14 group declarations without turning absent associations into findings', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document('# Flow\n\n## Details\n\n1. A {#first}\n2. B {#second}\n3. C {#third}\n\n## Acceptance\n\n1. No ID\n'));
  write(root, 'test/flow.ts', `// @use-case ${path}#first\n// @name stable\n\n// @use-case ${path}#second\n\n// @use-case ${path}#details\n\n// @use-case ${path}\n\n// pytest.mark.third\n`);
  write(root, 'src/flow.ts', `// @concord-file\n// @concord-implements ${path}#first\nexport const flow = 1;\n`);
  for (const cache of ['off', 'use', 'rebuild'] as const) {
    const trace = buildTrace(repo, cache);
    assert.equal(trace.complete, true, JSON.stringify(trace.findings));
    assert.equal(trace.annotations.cases.length, 4);
  }
  const cachePath = join(repo.privateDir, 'cache.hawdb');
  rmSync(cachePath, { recursive: true, force: true }); writeFileSync(cachePath, 'damaged cache');
  assert.equal(buildTrace(repo, 'use').complete, true);
  rmSync(cachePath);
  clearCache(repo);
  assert.equal(buildTrace(repo, 'use').complete, true);
  const groups = traceShow(repo, path, 'off').stepGroups[0]!;
  assert.deepEqual(groups.steps.map(step => [step.id, step.testCount, step.codeCount]), [['first', 1, 1], ['second', 1, 0], ['third', 0, 0]]);
  assert.deepEqual(groups.unassociatedSteps, [`${path}#third`]);
  assert.equal(groups.nonStepAnchors[0]?.ref, `${path}#details`);
  assert.equal(groups.wholeUseCase.tests.length, 1);
  assert.equal(groups.observation.result, 'not-observed');
  assert.equal(traceGaps(repo, 'off').unmarkedLists[0]?.path, path);
  assert.match(renderReview(repo, path, 'off'), /Non-step anchor:/u);
  write(root, 'test/missing.ts', `// @use-case ${path}#missing\n`);
  assert.ok(buildTrace(repo, 'off').findings.some(finding => finding.code === 'AnchorNotFound'));
  const before = parseTestDeclarations('test/flow.ts', `// @use-case ${path}\n// @name stable\n`).cases[0]!;
  const after = parseTestDeclarations('test/flow.ts', `// @use-case ${path}#first\n// @name stable\n`).cases[0]!;
  assert.equal(before.id, after.id);
  assert.notEqual(digest(before.contract), digest(after.contract));
}))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#declare-steps
// @name steps-format
test('steps C16 C17 C21 format seeds only an explicit list, skips occupied and dangling IDs and is idempotent', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  const unmarked = document('# Flow\n\n1. A   \n2. B\t\n\n## Acceptance\n\n1. Keep\n');
  write(root, path, unmarked);
  assert.deepEqual(formatUseCase(repo, path).changedPaths, []);
  assert.throws(() => formatUseCase(repo, path, true), { code: 'InvalidStepList' });
  assert.throws(() => formatUseCase(repo, path, true, 9), { code: 'InvalidStepList' });
  assert.deepEqual(formatUseCase(repo, path, true, 1, true).changedPaths, [path]);
  assert.equal(repo.read(path), unmarked);
  formatUseCase(repo, path, true, 1);
  assert.deepEqual(useCaseSteps(repo, path).steps.map(step => step.id), ['step-1', 'step-2']);
  assert.deepEqual(formatUseCase(repo, path).changedPaths, []);
  assert.equal(useCaseSteps(repo, path).lists[1]?.marked, 0);
  write(root, path, document('# Flow\n\n## step-2\n\n1. A   {#step-1}\n2. B\n3. C {#named}\n'));
  write(root, 'test/old.ts', `// @use-case ${path}#step-3\n`);
  formatUseCase(repo, path);
  assert.deepEqual(extractSteps(path, repo.read(path)!).steps.map(step => step.id), ['step-1', 'step-4', 'named']);
  assert.match(repo.read(path)!, /A \{#step-1\}/u);
  assert.deepEqual(formatUseCase(repo, path).changedPaths, []);
  write(root, 'test/invalid.ts', '// @use-case\n');
  assert.throws(() => formatUseCase(repo, path), { code: 'ReferenceScanIncomplete' });
}))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-rename-exact-tokens
test('steps C18 rename updates all real tokens and reports named and unnamed identities', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document('# Flow\n\n1. First {#step-2}\n\n[Self](#step-2)\n'));
  const oldRef = `${path}#step-2`;
  const testSource = `const str = '// @use-case ${oldRef}';\nconst template = \`// @use-case ${oldRef}\`;\nconst regex = /\/\/ @use-case fake/;\n// @use-case ${oldRef}\n// @name stable\n\n// @use-case ${oldRef}\n\n// @use-case ${path}#拒绝过期令牌\n`;
  write(root, 'test/flow.ts', testSource);
  write(root, 'test/flow.py', `# @use-case ${oldRef}\n`);
  write(root, 'src/flow.ts', `// @concord-file\n// @concord-implements ${oldRef}\nconst text = '// @concord-implements ${oldRef}';\n`);
  write(root, 'docs/feature/sample/links.md', `[Flow](use-case/flow.md#step-2 "Title")\n\n[Again][flow]\n\n[flow]: <use-case/flow.md#step-2>\n\n\`[Example](use-case/flow.md#step-2)\`\n\n~~~md\n[Fake](use-case/flow.md#step-2)\n~~~\n`);
  chmodSync(join(root, 'test/flow.py'), 0o755);
  const preview = renameUseCaseStep(repo, path, 'step-2', '拒绝过期令牌', true);
  assert.equal(repo.read('test/flow.ts'), testSource);
  assert.equal(preview.affectedCases.length, 4);
  assert.equal(preview.affectedCases.find(item => item.named)?.before, preview.affectedCases.find(item => item.named)?.after);
  assert.ok(preview.affectedCases.filter(item => !item.named).every(item => item.before !== item.after));
  renameUseCaseStep(repo, path, 'step-2', '拒绝过期令牌');
  assert.match(repo.read(path)!, /\[Self\]\(#拒绝过期令牌\)/u);
  assert.ok(repo.read('test/flow.ts')!.startsWith(testSource.slice(0, testSource.indexOf('\n// @use-case'))));
  assert.match(repo.read('docs/feature/sample/links.md')!, /\[Flow\]\(use-case\/flow.md#拒绝过期令牌/u);
  assert.match(repo.read('docs/feature/sample/links.md')!, /`\[Example\]\(use-case\/flow.md#step-2\)`/u);
  assert.equal(fs.statSync(join(root, 'test/flow.py')).mode & 0o777, 0o755);
  assert.equal(buildTrace(repo, 'off').complete, true);
}))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-publication-conflicts
test('steps C19 precommit drift writes nothing and interrupted publication returns RecoveryRequired', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  write(root, 'test/flow.ts', `// @use-case ${path}#old\n`);
  const original = repo.read(path)!;
  assert.throws(() => repo.snapshot(() => {
    const plan = planStepRename(repo, { useCase: path, oldId: 'old', newId: 'new' });
    write(root, 'test/flow.ts', `// @use-case ${path}#old\n// external edit\n`);
    repo.publishStepRename(plan);
  }), { code: 'FileChangedSinceRead' });
  assert.equal(repo.read(path), original);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { rename(from, to); if (String(to) === join(root, path)) throw new Error('Interrupted after replacement'); };
  syncBuiltinESMExports();
  try { assert.throws(() => renameUseCaseStep(repo, path, 'old', 'new'), { code: 'RecoveryRequired' }); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), true);
}))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-process-death-and-recovery
test('steps C19 second CLI blocks interrupted work and recovers prepared and committed journals without overwriting unknown edits', () => Effect.runPromise(Effect.sync(() => {
  for (const phase of ['prepared', 'committed', 'unknown'] as const) consumer((repo, root) => {
    write(root, path, document('1. A {#old}\n'));
    write(root, 'test/flow.ts', `// @use-case ${path}#old\n`);
    const before = repo.read(path)!;
    repo.close();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/support/step-interruption.ts'), entry, '--root', root, '--json', 'use-case', 'rename-step', path, 'old', 'new'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, STEP_ROOT: root, STEP_INTERRUPT: phase === 'committed' ? 'committed' : 'prepared' } });
    assert.equal(child.signal, 'SIGKILL', child.stdout + child.stderr);
    const journal = join(genericPrivateDirectorySync(root), 'journal.json');
    assert.ok(existsSync(journal));
    const error = Schema.Struct({ error: Schema.String });
    assert.equal(Schema.decodeUnknownSync(error)(cli(root, ['use-case', 'steps', path], 1)).error, 'RecoveryRequired');
    assert.equal(Schema.decodeUnknownSync(error)(cli(root, ['use-case', 'format', path], 1)).error, 'RecoveryRequired');
    if (phase === 'unknown') {
      write(root, 'test/flow.ts', '// External edit\n');
      assert.equal(Schema.decodeUnknownSync(error)(cli(root, ['recover'], 1)).error, 'RecoveryConflict');
      assert.equal(readFileSync(join(root, 'test/flow.ts'), 'utf8'), '// External edit\n');
      assert.ok(existsSync(journal));
    } else {
      const result = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }))(cli(root, ['recover']));
      assert.equal(result.status, phase === 'prepared' ? 'rolled-back' : 'committed');
      assert.equal(readFileSync(join(root, path), 'utf8'), phase === 'prepared' ? before : before.replace('{#old}', '{#new}'));
      assert.equal(existsSync(journal), false);
      cli(root, ['use-case', 'steps', path]);
    }
  });
})));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-managed-reference-block
test('steps rename updates ordinary Design decision Markdown references', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  createDocument(repo, 'design', { id: 'sample', title: 'Sample', pages: [] });
  const design = 'docs/design/sample.md';
  write(root, design, `${repo.read(design)!}\n[Step](../../feature/sample/use-case/flow.md#old)\n`);
  renameUseCaseStep(repo, path, 'old', 'new');
  assert.match(repo.read(path)!, /\{#new\}/u);
  assert.match(repo.read(design)!, /flow\.md#new/u);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
}))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-recovery-authorization
test('steps C19 recovery rejects a forged postimage even when its digest matches', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  write(root, 'test/flow.ts', `// @use-case ${path}#old\n`);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { rename(from, to); if (String(to) === join(root, path)) throw new Error('Interrupted after replacement'); };
  syncBuiltinESMExports();
  try { assert.throws(() => renameUseCaseStep(repo, path, 'old', 'new'), { code: 'RecoveryRequired' }); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  const journalPath = join(repo.privateDir, 'journal.json');
  const journal = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(readFileSync(journalPath, 'utf8'));
  const changes = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ path: Schema.String, before: Schema.String, after: Schema.String, beforeDigest: Schema.String, afterDigest: Schema.String, mode: Schema.Int })))(journal.changes);
  const forged = changes.map(change => {
    if (change.path !== 'test/flow.ts') return change;
    const after = `${change.after}throw new Error('unauthorized edit');\n`;
    return { ...change, after, afterDigest: digest(after) };
  });
  writeFileSync(journalPath, JSON.stringify({ ...journal, changes: forged }));
  repo.close();
  const error = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(cli(root, ['recover'], 1));
  assert.equal(error.error, 'RecoveryConflict');
  assert.ok(existsSync(journalPath));
  assert.equal(readFileSync(join(root, 'test/flow.ts'), 'utf8'), `// @use-case ${path}#old\n`);
}))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-memory-reference-block
test('steps C20 Memory support relations block rename with zero writes', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  createDocument(repo, 'memory', { id: 'support', title: 'Support' });
  const memory = loadDocuments(repo, ['memory'])[0]!;
  if (memory.metadata.kind !== 'memory') throw new Error('Expected Memory');
  write(root, memory.path, renderDocument({ ...memory.metadata, relations: [{ role: 'supports', target: `${path}#old` }] }, memory.body));
  assert.throws(() => renameUseCaseStep(repo, path, 'old', 'new'), { code: 'ManagedReferenceBlocked' });
  assert.match(repo.read(path)!, /\{#old\}/u);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
}))));

// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
// @name steps-writing-length
test('steps writing ignores real terminal IDs in sentence and paragraph length but retains inline examples', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  write(root, path, document(`# Flow\n\n1. Short {#${'long'.repeat(30)}}\n`));
  write(root, 'steps-policy.json', JSON.stringify({ format: 'concord.writing/v3', roots: [path], bannedTerms: [], sentenceLength: 12, paragraphLength: 12,
    controlled: { language: 'en', sentence: { en: { procedural: 1 } } } }));
  assert.deepEqual(checkWriting(repo, 'steps-policy.json').findings, []);
  write(root, path, document(`# Flow\n\n1. Short \`{#${'long'.repeat(30)}}\`\n`));
  const findings = checkWriting(repo, 'steps-policy.json').findings;
  assert.ok(findings.some(finding => finding.rule === 'sentenceLength'));
  assert.ok(findings.some(finding => finding.rule === 'paragraphLength'));
  assert.ok(findings.some(finding => finding.rule === 'proceduralSentenceLength'));
}))));
