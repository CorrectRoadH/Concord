import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { checkProject, executeQuery, executeViewAction, knowledgeIndex } from '../../src/app/index.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { decodeDocumentSource, diagnoseDocuments, readDocumentReference } from '../../src/domain/documents/index.ts';
import { closeIssue, linkIssue, unlinkIssue } from '../../src/domain/issues/index.ts';
import { ConcordError, ViewActionSchema, decode } from '../../src/model/index.ts';
import { createConsumer, withConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


// @use-case docs/feature/feedback/use-case/manage-local-observations.md#link
test('spec relations round-trip contract paths and anchors and enforce target and duplicate rules', () => withConsumer(repo => {
  createDocument(repo, 'feature', { id: 'target', title: 'Target', body: '# Target\n\n## Step {#step}\n' });
  createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'target' });
  createDocument(repo, 'engineering', { id: 'rules', title: 'Rules' });
  createDocument(repo, 'memory', { id: 'notes', title: 'Notes' });
  createDocument(repo, 'issue', { id: 'observation', title: 'Observation' });
  const path = 'docs/issues/observation.md';
  const targets = ['docs/feature/target/README.md#step', 'docs/feature/target/use-case/flow.md', 'docs/engineering/rules/README.md'];
  const before = repo.read(path);
  linkIssue(repo, 'observation', targets[0]!, true, 'spec');
  assert.equal(repo.read(path), before, 'dry run preserves the authored file');
  for (const target of targets) linkIssue(repo, 'observation', target, false, 'spec');
  const record = readDocumentReference(repo, path, ['issue']);
  assert.deepEqual(record.metadata.kind === 'issue' && record.metadata.relations, targets.map(target => ({ role: 'spec', target })));
  assert.throws(() => linkIssue(repo, 'observation', targets[0]!, false, 'spec'), { code: 'DuplicateLink' });
  assert.throws(() => linkIssue(repo, 'observation', 'memory/notes.md', false, 'spec'), { code: 'InvalidReferenceTarget' });
  assert.throws(() => linkIssue(repo, 'observation', 'docs/feature/target/README.md#missing', false, 'spec'), { code: 'AnchorNotFound' });
  for (const target of targets) unlinkIssue(repo, 'observation', target, false, 'spec');
  assert.equal(repo.read(path), before);
  assert.throws(() => unlinkIssue(repo, 'observation', targets[0]!, false, 'spec'), { code: 'LinkNotFound' });
}));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md#link
test('invalid Issue roles remain per-file findings and cannot authorize close from a partial graph', () => withConsumer((repo, root) => {
  createDocument(repo, 'issue', { id: 'healthy', title: 'Healthy' });
  const paths = ['docs/issues/retired.md', 'docs/issues/unknown.md'];
  const sources = ['adopts', 'anything'].map(role => `---\nrelations:\n  - role: ${role}\n    target: docs/feature/target/README.md\n---\n\n# Invalid role\n`);
  paths.forEach((path, index) => writeFileSync(join(root, path), sources[index]!));
  const inventory = diagnoseDocuments(repo, ['issue']);
  assert.equal(inventory.complete, false);
  assert.deepEqual(inventory.documents.map(record => record.path), ['docs/issues/healthy.md']);
  assert.deepEqual(inventory.findings.map(finding => [finding.code, finding.path]), paths.map(path => ['InvalidData', path]));
  for (const finding of inventory.findings) {
    assert.match(finding.message, /role/u);
    for (const role of ['investigation', 'root-cause', 'related', 'spec']) assert.ok(finding.message.includes(role), finding.message);
    assert.throws(() => readDocumentReference(repo, finding.path), { code: 'InvalidData' });
  }
  const index = knowledgeIndex(repo, 'issue');
  assert.equal(index.complete, false);
  assert.deepEqual(index.documents.map(record => record.path), ['docs/issues/healthy.md']);
  assert.deepEqual(index.findings, inventory.findings);
  assert.equal(readDocumentReference(repo, 'docs/issues/healthy.md').metadata.id, 'healthy');
  const diagnostic = checkProject(repo, 'off');
  assert.equal(diagnostic.complete, false);
  assert.ok(paths.every(path => diagnostic.findings.some(finding => finding.path === path && finding.code === 'InvalidData')));
  assert.throws(() => closeIssue(repo, 'healthy'), { code: 'InvalidData' });
  assert.ok(repo.read('docs/issues/healthy.md'));
  paths.forEach((path, index) => assert.equal(readFileSync(join(root, path), 'utf8'), sources[index]));
}));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md#link
test('action uses memory as its target field with spec and retains the default investigation role', async () => {
  const root = createConsumer();
  try {
    const repo = new LocalRepository(root);
    try {
      createDocument(repo, 'feature', { id: 'target', title: 'Target' });
      createDocument(repo, 'memory', { id: 'notes', title: 'Notes' });
      createDocument(repo, 'issue', { id: 'observation', title: 'Observation' });
    } finally { repo.close(); }
    const input = { action: 'issue.link', id: 'observation', memory: 'docs/feature/target/README.md', role: 'spec', dryRun: true };
    const action = decode(ViewActionSchema, input, 'action');
    const path = join(root, 'docs/issues/observation.md');
    const before = readFileSync(path, 'utf8');
    await runApplication(executeViewAction(root, action));
    assert.equal(readFileSync(path, 'utf8'), before);
    await runApplication(executeViewAction(root, { action: 'issue.link', id: 'observation', memory: input.memory, role: 'spec' }));
    assert.match(readFileSync(path, 'utf8'), /role: spec/u);
    await runApplication(executeViewAction(root, { action: 'issue.unlink', id: 'observation', memory: input.memory, role: 'spec' }));
    assert.equal(readFileSync(path, 'utf8'), before);
    await runApplication(executeViewAction(root, { action: 'issue.link', id: 'observation', memory: 'memory/notes.md' }));
    assert.match(readFileSync(path, 'utf8'), /role: investigation/u);
    for (const action of ['issue.link', 'issue.unlink']) {
      assert.throws(() => decode(ViewActionSchema, { ...input, action, role: 'adopts' }, 'action'), { code: 'InvalidData' });
      assert.throws(() => decode(ViewActionSchema, { ...input, action, target: input.memory }, 'action'), { code: 'InvalidData' });
    }
    const retired = await runApplication(executeViewAction(root, { action: 'feedback.link', id: 'observation', feature: 'target' }).pipe(Effect.result));
    assert.equal(retired._tag, 'Failure');
    if (retired._tag === 'Failure') {
      assert.equal(retired.failure.code, 'CommandRetired');
      assert.match(retired.failure.message, /concord issue link <id> --role spec <target>/u);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('warm document and repository caches never authorize invalid relation bytes', () => withConsumer((repo, root) => {
  createDocument(repo, 'feature', { id: 'target', title: 'Target' });
  createDocument(repo, 'issue', { id: 'observation', title: 'Observation' });
  linkIssue(repo, 'observation', 'docs/feature/target/README.md', false, 'spec');
  PersistentCache.repository(repo).prepareWrite({ create: true });
  const path = 'docs/issues/observation.md';
  const valid = readFileSync(join(root, path), 'utf8');
  assert.equal(knowledgeIndex(repo, 'issue').complete, true);
  assert.ok(decodeDocumentSource(path, valid, parserRuntime));
  const invalid = valid.replace('role: spec', 'role: adopts');
  writeFileSync(join(root, path), invalid);
  for (let read = 0; read < 2; read++) {
    assert.throws(() => decodeDocumentSource(path, invalid, parserRuntime), (cause: unknown) => cause instanceof ConcordError && cause.code === 'InvalidData');
    const result = knowledgeIndex(repo, 'issue');
    assert.equal(result.complete, false);
    assert.deepEqual(result.documents, []);
    assert.equal(result.findings[0]?.code, 'InvalidData');
    assert.equal(readFileSync(join(root, path), 'utf8'), invalid);
  }
  writeFileSync(join(root, path), valid);
  assert.equal(knowledgeIndex(repo, 'issue').complete, true);
}));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md#link
test('public exact Issue reads isolate unrelated invalid roles while diagnostic queries preserve findings', async () => {
  const root = createConsumer();
  try {
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'issue', { id: 'healthy', title: 'Healthy' }); }
    finally { repo.close(); }
    const path = join(root, 'docs/issues/invalid.md');
    const source = '---\nrelations:\n  - role: adopts\n    target: docs/feature/target/README.md\n---\n\n# Invalid\n';
    writeFileSync(path, source);
    for (const request of [
      { name: 'documents.show', input: { id: 'docs/issues/healthy.md', kind: 'issue' } },
      { name: 'feedback.show', input: { id: 'healthy' } },
    ] as const) {
      const reply = await runApplication(executeQuery(root, request, 'off'));
      assert.equal(reply.exitCode, 0);
      assert.match(JSON.stringify(reply.value), /Healthy/u);
    }
    const index = await runApplication(executeViewAction(root, { action: 'issue.index' }));
    assert.match(JSON.stringify(index), /"complete":false/u);
    assert.match(JSON.stringify(index), /docs\/issues\/invalid.md/u);
    for (const request of [
      { name: 'documents.show', input: { id: 'docs/issues/invalid.md', kind: 'issue' } },
      { name: 'feedback.show', input: { id: 'invalid' } },
    ] as const) {
      const result = await runApplication(executeQuery(root, request, 'off').pipe(Effect.result));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') {
        assert.equal(result.failure.code, 'InvalidData');
        assert.match(result.failure.message, /docs\/issues\/invalid.md/u);
      }
    }
    assert.equal(readFileSync(path, 'utf8'), source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
