import { writeProjectConfig } from '../support/support.ts';
import { createConsumer } from '../support/consumer.ts';
import { recoverLocalState } from '../../src/app/index.ts';
import { createDocument } from '../support/operations.ts';
import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { syncBuiltinMocks as syncBuiltinESMExports } from '../support/builtin-mocks.ts';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { extractSteps } from "../../src/domain/documents/index.ts";
import { formatUseCase, renameUseCaseStep, useCaseSteps } from "../../src/app/index.ts";
import { planStepRename } from "../../src/app/index.ts";
import { loadDocuments } from "../../src/domain/documents/index.ts";

import { renderDocument } from "../../src/model/index.ts";
import { LocalRepository, runApplication } from "../support/repository.ts";

import { buildTrace } from "../../src/domain/trace/index.ts";
import { renderReview, traceGaps, traceShow } from "../../src/app/index.ts";
import { clearCache, parseTestDeclarations } from "../../src/domain/tests/index.ts";
import { digest } from "../../src/model/index.ts";
import { checkWriting } from "../../src/domain/writing/index.ts";
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


const path = 'docs/feature/sample/use-case/flow.md';
function document(body: string, kind: 'use-case' | 'feature' = 'use-case') {
  return renderDocument(kind === 'use-case' ? { format: 'concord.document/v1', kind, id: 'flow', title: 'Flow', feature: 'docs/feature/sample/README.md' } : { format: 'concord.document/v1', kind, id: 'sample', title: 'Sample' }, body);
}
async function consumer(run: (repo: LocalRepository, root: string) => void) {
  const root = (await createConsumer());
  writeProjectConfig(root, { sourceRoots: ['src'], testRoots: ['test'] });
  let repo: LocalRepository | undefined;
  try {
    repo = (await LocalRepository.open(root));
    (await createDocument(repo, 'feature', { id: 'sample', title: 'Sample', pages: [] }));
    (await createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample' }));
    for (const dir of ['src', 'test']) mkdirSync(join(root, dir));
    await run(repo, root);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
}
function write(root: string, file: string, source: string) { mkdirSync(resolve(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), source); }

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#declare-steps
// @name steps-ast-and-namespace
test('steps C1 C3 C4 C10 C11 C12 use AST positions, exact Unicode IDs and one heading namespace', () => Effect.runPromise(Effect.sync(() => {
  const source = document('# Flow\n\n## 流程\n\n7. First 😀  {#拒绝令牌}\n8. Second\n   continuation {#second}\n\n## Acceptance\n\n1. Ordinary\n\n```md\n1. fake {#fence}\n```\n\n1. `example {#inline}`\n\n<div>\n1. fake {#html}\n</div>\n');
  const result = extractSteps(path, source, parserRuntime);
  assert.deepEqual(result.steps.map(step => [step.id, step.ordinal, step.listOrdinal]), [['拒绝令牌', 1, 1], ['second', 2, 1]]);
  assert.deepEqual(result.findings, []);
  for (const marker of result.markers) assert.match(source.split('\n')[marker.line - 1]!.slice(marker.startColumn, marker.endColumn), /^ +\{#[^}]+\}$/u);
  assert.ok(result.steps[1]!.endLine > result.steps[1]!.line);
  assert.deepEqual(extractSteps(path, document('# Flow\n\n1. New unmarked\n2. Second {#second}\n3. First {#拒绝令牌}\n'), parserRuntime).steps.map(step => [step.id, step.ordinal]), [['second', 1], ['拒绝令牌', 2]]);
  for (const body of ['## foo--bar\n\n1. Item {#foo-bar}\n', '## Title {#custom}\n\n1. Item {#custom}\n', '## Title {#custom} ###\n\n1. Item {#title}\n', '1. One {#same}\n2. Two {#same}\n']) assert.equal(extractSteps(path, document(body), parserRuntime).findings[0]?.code, 'DuplicateAnchor');
  assert.deepEqual(extractSteps(path, document('1. Text <span>sample {#inside}\n'), parserRuntime).steps, []);
  assert.equal(extractSteps(path, document('1. Text <span>sample</span> {#outside}\n'), parserRuntime).steps[0]?.id, 'outside');
  assert.deepEqual(extractSteps(path, document('1. A {#é}\n2. B {#é}\n3. C {#É}\n'), parserRuntime).findings, []);
  for (const body of ['- Wrong {#bad}\n', '1. Parent\n   1. Nested {#bad}\n', 'Paragraph {#bad}\n', '1. Bad {#two--parts}\n']) assert.equal(extractSteps(path, document(body), parserRuntime).findings[0]?.code, 'InvalidStepPosition');
  assert.equal(extractSteps('docs/feature/sample/README.md', document('1. Wrong {#bad}\n', 'feature'), parserRuntime).findings[0]?.code, 'InvalidStepPosition');
  assert.equal(extractSteps('docs/feature/sample/cli.md', '1. Wrong {#bad}\n', parserRuntime).findings[0]?.code, 'InvalidStepPosition');
})));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#inspect-associations
// @name steps-trace-and-static-gate
test('steps C2 C5 C9 C13 C14 group declarations without turning absent associations into findings', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async (repo, root) => {
  write(root, path, document('# Flow\n\n## Details\n\n1. A {#first}\n2. B {#second}\n3. C {#third}\n\n## Acceptance\n\n1. No ID\n'));
  write(root, 'test/flow.ts', `// @use-case ${path}#first\n// @name stable\n\n// @use-case ${path}#second\n\n// @use-case ${path}#details\n\n// @use-case ${path}\n\n// pytest.mark.third\n`);
  write(root, 'src/flow.ts', `// @concord-file\n// @concord-implements ${path}#first\nexport const flow = 1;\n`);
  for (const cache of ['off', 'use', 'rebuild'] as const) {
    const trace = (await buildTrace(repo, cache));
    assert.equal(trace.complete, true, JSON.stringify(trace.findings));
    assert.equal(trace.annotations.cases.length, 4);
  }
  const cachePath = join(repo.privateDir, 'cache.hawdb');
  rmSync(cachePath, { recursive: true, force: true }); writeFileSync(cachePath, 'damaged cache');
  await assert.rejects(buildTrace(repo, 'use'), { code: 'UnsafePath' });
  rmSync(cachePath);
  clearCache(repo);
  assert.equal((await buildTrace(repo, 'use')).complete, true);
  const groups = (await traceShow(repo, path, 'off')).stepGroups[0]!;
  assert.deepEqual(groups.steps.map(step => [step.id, step.testCount, step.codeCount]), [['first', 1, 1], ['second', 1, 0], ['third', 0, 0]]);
  assert.deepEqual(groups.unassociatedSteps, [`${path}#third`]);
  assert.equal(groups.nonStepAnchors[0]?.ref, `${path}#details`);
  assert.equal(groups.wholeUseCase.tests.length, 1);
  assert.equal(groups.observation.result, 'not-observed');
  assert.equal((await traceGaps(repo, 'off')).unmarkedLists[0]?.path, path);
  assert.match((await renderReview(repo, path, 'off')), /Non-step anchor:/u);
  write(root, 'test/missing.ts', `// @use-case ${path}#missing\n`);
  assert.ok((await buildTrace(repo, 'off')).findings.some(finding => finding.code === 'AnchorNotFound'));
  const before = (await parseTestDeclarations('test/flow.ts', `// @use-case ${path}\n// @name stable\n`)).cases[0]!;
  const after = (await parseTestDeclarations('test/flow.ts', `// @use-case ${path}#first\n// @name stable\n`)).cases[0]!;
  assert.equal(before.id, after.id);
  assert.notEqual(digest(before.contract), digest(after.contract));
})))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#declare-steps
// @name steps-format
test('steps C16 C17 C21 format seeds only an explicit list, skips occupied and dangling IDs and is idempotent', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async (repo, root) => {
  const unmarked = document('# Flow\n\n1. A   \n2. B\t\n\n## Acceptance\n\n1. Keep\n');
  write(root, path, unmarked);
  assert.deepEqual((await formatUseCase(repo, path)).changedPaths, []);
  (await assert.rejects(async () => (await formatUseCase(repo, path, true)), { code: 'InvalidStepList' }));
  (await assert.rejects(async () => (await formatUseCase(repo, path, true, 9)), { code: 'InvalidStepList' }));
  assert.deepEqual((await formatUseCase(repo, path, true, 1, true)).changedPaths, [path]);
  assert.equal(repo.read(path), unmarked);
  (await formatUseCase(repo, path, true, 1));
  assert.deepEqual((await useCaseSteps(repo, path)).steps.map(step => step.id), ['step-1', 'step-2']);
  assert.deepEqual((await formatUseCase(repo, path)).changedPaths, []);
  assert.equal((await useCaseSteps(repo, path)).lists[1]?.marked, 0);
  write(root, path, document('# Flow\n\n## step-2\n\n1. A   {#step-1}\n2. B\n3. C {#named}\n'));
  write(root, 'test/old.ts', `// @use-case ${path}#step-3\n`);
  (await formatUseCase(repo, path));
  assert.deepEqual(extractSteps(path, repo.read(path)!, parserRuntime).steps.map(step => step.id), ['step-1', 'step-4', 'named']);
  assert.match(repo.read(path)!, /A \{#step-1\}/u);
  assert.deepEqual((await formatUseCase(repo, path)).changedPaths, []);
  write(root, 'test/invalid.ts', '// @use-case\n');
  (await assert.rejects(async () => (await formatUseCase(repo, path)), { code: 'ReferenceScanIncomplete' }));
})))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-rename-exact-tokens
test('steps C18 rename updates all real tokens and reports named and unnamed identities', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async (repo, root) => {
  write(root, path, document('# Flow\n\n1. First {#step-2}\n\n[Self](#step-2)\n'));
  const oldRef = `${path}#step-2`;
  const testSource = `const str = '// @use-case ${oldRef}';\nconst template = \`// @use-case ${oldRef}\`;\nconst regex = /\/\/ @use-case fake/;\n// @use-case ${oldRef}\n// @name stable\n\n// @use-case ${oldRef}\n\n// @use-case ${path}#拒绝过期令牌\n`;
  write(root, 'test/flow.ts', testSource);
  write(root, 'test/flow.py', `# @use-case ${oldRef}\n`);
  write(root, 'src/flow.ts', `// @concord-file\n// @concord-implements ${oldRef}\nconst text = '// @concord-implements ${oldRef}';\n`);
  write(root, 'docs/feature/sample/links.md', `[Flow](use-case/flow.md#step-2 "Title")\n\n[Again][flow]\n\n[flow]: <use-case/flow.md#step-2>\n\n\`[Example](use-case/flow.md#step-2)\`\n\n~~~md\n[Fake](use-case/flow.md#step-2)\n~~~\n`);
  chmodSync(join(root, 'test/flow.py'), 0o755);
  const preview = (await renameUseCaseStep(repo, path, 'step-2', '拒绝过期令牌', true));
  assert.equal(repo.read('test/flow.ts'), testSource);
  assert.equal(preview.affectedCases.length, 4);
  assert.equal(preview.affectedCases.find(item => item.named)?.before, preview.affectedCases.find(item => item.named)?.after);
  assert.ok(preview.affectedCases.filter(item => !item.named).every(item => item.before !== item.after));
  (await renameUseCaseStep(repo, path, 'step-2', '拒绝过期令牌'));
  assert.match(repo.read(path)!, /\[Self\]\(#拒绝过期令牌\)/u);
  assert.ok(repo.read('test/flow.ts')!.startsWith(testSource.slice(0, testSource.indexOf('\n// @use-case'))));
  assert.match(repo.read('docs/feature/sample/links.md')!, /\[Flow\]\(use-case\/flow.md#拒绝过期令牌/u);
  assert.match(repo.read('docs/feature/sample/links.md')!, /`\[Example\]\(use-case\/flow.md#step-2\)`/u);
  assert.equal(fs.statSync(join(root, 'test/flow.py')).mode & 0o777, 0o755);
  assert.equal((await buildTrace(repo, 'off')).complete, true);
})))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-publication-conflicts
test('steps C19 precommit drift writes nothing and interrupted publication returns RecoveryRequired', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async (repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  write(root, 'test/flow.ts', `// @use-case ${path}#old\n`);
  const original = repo.read(path)!;
  (await assert.rejects(async () => (await repo.snapshot(async () => {
    const plan = (await planStepRename(repo, { useCase: path, oldId: 'old', newId: 'new' }));
    write(root, 'test/flow.ts', `// @use-case ${path}#old\n// external edit\n`);
    (await repo.publishStepRename(plan));
  })), { code: 'FileChangedSinceRead' }));
  assert.equal(repo.read(path), original);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { rename(from, to); if (String(to) === join(root, path)) throw new Error('Interrupted after replacement'); };
  syncBuiltinESMExports();
  try { (await assert.rejects(async () => (await renameUseCaseStep(repo, path, 'old', 'new')), { code: 'RecoveryRequired' })); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), true);
})))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-managed-reference-block
test('steps rename updates single-page Design Markdown references', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async (repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  (await createDocument(repo, 'design', { id: 'sample', title: 'Sample' }));
  const design = 'docs/design/sample.md';
  write(root, design, `${repo.read(design)!}\n[Step](../feature/sample/use-case/flow.md#old)\n`);
  (await renameUseCaseStep(repo, path, 'old', 'new'));
  assert.match(repo.read(path)!, /\{#new\}/u);
  assert.match(repo.read(design)!, /flow\.md#new/u);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
})))));

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-recovery-authorization
test('steps C19 recovery rejects a forged postimage even when its digest matches', async () => {
  const root = (await createConsumer());
  writeProjectConfig(root, { sourceRoots: ['src'], testRoots: ['test'] });
  const repo = (await LocalRepository.open(root));
  try {
  (await createDocument(repo, 'feature', { id: 'sample', title: 'Sample', pages: [] }));
  (await createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample' }));
  for (const dir of ['src', 'test']) mkdirSync(join(root, dir));
  write(root, path, document('1. A {#old}\n'));
  write(root, 'test/flow.ts', `// @use-case ${path}#old\n`);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { rename(from, to); if (String(to) === join(root, path)) throw new Error('Interrupted after replacement'); };
  syncBuiltinESMExports();
  try { (await assert.rejects(async () => (await renameUseCaseStep(repo, path, 'old', 'new')), { code: 'RecoveryRequired' })); }
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
  await assert.rejects(runApplication(recoverLocalState(root)), error => {
    assert.equal((error as { code: string }).code, 'RecoveryConflict'); return true;
  });
  assert.ok(existsSync(journalPath));
  assert.equal(readFileSync(join(root, 'test/flow.ts'), 'utf8'), `// @use-case ${path}#old\n`);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-memory-reference-block
test('steps C20 Memory support relations block rename with zero writes', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async (repo, root) => {
  write(root, path, document('1. A {#old}\n'));
  (await createDocument(repo, 'memory', { id: 'support', title: 'Support' }));
  const memory = loadDocuments(repo, ['memory'])[0]!;
  if (memory.metadata.kind !== 'memory') throw new Error('Expected Memory');
  write(root, memory.path, renderDocument({ ...memory.metadata, relations: [{ role: 'supports', target: `${path}#old` }] }, memory.body));
  (await assert.rejects(async () => (await renameUseCaseStep(repo, path, 'old', 'new')), { code: 'ManagedReferenceBlocked' }));
  assert.match(repo.read(path)!, /\{#old\}/u);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
})))));

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
// @name steps-writing-length
test('steps writing ignores real terminal IDs in sentence and paragraph length but ignores inline examples', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer((repo, root) => {
  write(root, path, document(`# Flow\n\n1. Short {#${'long'.repeat(30)}}\n`));
  write(root, 'docs/writing.md', '# Rules\n\n句子不超过 12 个字符，段落不超过 12 个字符。\n\n## 检查范围\n\n- ' + path + '\n');
  assert.deepEqual(checkWriting(repo).findings, []);
  write(root, path, document(`# Flow\n\n1. Short \`{#${'long'.repeat(30)}}\`\n`));
  const findings = checkWriting(repo).findings;
  assert.deepEqual(findings, []);
})))));
