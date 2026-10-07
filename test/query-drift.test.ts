import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { scanCode } from '../src/code.js';
import { initialize, LocalRepository } from '../src/storage.js';
import { Effect, Schema } from 'effect';
import { QueryCacheEnvelope, queryRequestSatisfied, replaceQueryEnvelope, type QueryUpdate } from '../src/query-cache.js';
import { classifyQueryRefresh, classifyQueryScan } from '../src/query-refresh-worker.js';
import { decodeQueryScanMessage } from '../src/query-scan-protocol.js';
import { TraceShowValue, hydrateQueryValue, stripQueryBodies } from '../src/query-values.js';
import { requireValidTrace, siftQueryDrift, type buildTrace } from '../src/trace.js';
import { ConcordError, digest, type Finding, type Repository } from '../src/shared.js';
import { renderDocument } from '../src/documents.js';
import type { OwnedProcessResult } from '../src/owned-process.js';

const value = { operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: [], contracts: [], cliPages: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } };
function candidate(at: number, paths: string[] = [], publicationChanged = false): QueryUpdate {
  return { kind: 'candidate', message: { format: 'concord.query-scan/v1', ok: true, scannedAt: at, finishedAt: at + 10, value, complete: true, unknown: [], drift: { files: paths, directories: [], publicationChanged } } };
}
const fail = (at: number): QueryUpdate => ({ kind: 'failure', error: { failedAt: new Date(at).toISOString(), scannedAt: at, code: 'InvalidConfig', message: 'invalid' } });
function trace(findings: Finding[]): ReturnType<typeof buildTrace> {
  return { documents: [], annotations: { cases: [], findings: [], files: [], digest: '', cache: value.cache }, codeDeclarations: [], codeFiles: [], edges: [], findings, complete: findings.length === 0, inventoryComplete: true, advisories: [], memories: [], codeCache: undefined, codeRelationsUnknown: findings.some(f => f.code === 'CodeSourceChanged') };
}
const success = decodeQueryScanMessage({ format: 'concord.query-scan/v1', ok: true, scannedAt: 100, finishedAt: 110, value, complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } });
function processResult(message: unknown = success, fields: Partial<OwnedProcessResult> = {}): OwnedProcessResult {
  return { command: [], exitCode: 0, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout: JSON.stringify(message), stderr: '', outputBytes: 0, processGroupOwned: true,
    groupCleanup: { owned: true, checked: true, aliveAfterLeaderClose: false, signalsSent: [], gone: true, detail: 'gone' }, ...fields };
}

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('sifts edit findings while preserving invalid trace diagnostics and incomplete inventories', () => Effect.runPromise(Effect.sync(() => {
  const input = trace([{ code: 'SourceChanged', path: 'test/a.ts', message: 'changed' }, { code: 'CodeSourceChanged', path: '.', message: 'changed' }]);
  const drift = siftQueryDrift(input);
  assert.deepEqual(drift, { files: ['test/a.ts', '.'], unknown: ['code'] });
  requireValidTrace(input);
  const invalid = trace([{ code: 'SourceChanged', path: 'docs/a.md', message: 'changed' }, { code: 'InvalidData', path: 'docs/b.md', message: 'invalid' }]);
  siftQueryDrift(invalid);
  assert.throws(() => requireValidTrace(invalid), { code: 'TraceInvalid' });
  assert.deepEqual(invalid.findings.map(f => f.code), ['InvalidData']);
  const incomplete = trace([{ code: 'SourceChanged', path: '.', message: 'changed' }]);
  incomplete.inventoryComplete = false;
  siftQueryDrift(incomplete);
  assert.throws(() => requireValidTrace(incomplete), { code: 'TraceInvalid' });
  const stableCodes = trace([{ code: 'CodeSourceChanged', path: '.', message: 'changed' }]);
  stableCodes.codeRelationsUnknown = false;
  stableCodes.codeDeclarations = [{ id: 'code', file: 'src/a.ts', line: 1, endLine: 1, scope: 'file', contracts: [] }];
  assert.deepEqual(siftQueryDrift(stableCodes).unknown, []);
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('all replacement rules keep one result and one attempt without rescan', () => Effect.runPromise(Effect.sync(() => {
  let envelope = replaceQueryEnvelope('key', undefined, candidate(100));
  const original = envelope.record;
  assert.equal(envelope.lastAttempt?.scannedAt, 100);
  envelope = replaceQueryEnvelope('key', envelope, fail(120));
  assert.deepEqual(envelope.record, original);
  assert.equal(envelope.lastAttempt?.scannedAt, 100);
  envelope = replaceQueryEnvelope('key', envelope, candidate(140, ['b', 'a', 'b'], true));
  assert.deepEqual(envelope.record, original);
  assert.deepEqual(envelope.lastAttempt?.changedPaths, ['.', 'a', 'b']);
  assert.equal(envelope.lastAttempt?.complete, false);
  assert.equal(envelope.error, undefined);
  envelope = replaceQueryEnvelope('key', envelope, { kind: 'drift', scannedAt: 160, at: new Date(170).toISOString(), changedPaths: [] });
  assert.deepEqual(envelope.record, original);
  assert.deepEqual(envelope.lastAttempt?.changedPaths, ['.']);
  envelope = replaceQueryEnvelope('key', envelope, candidate(180));
  assert.equal(envelope.record?.scannedAt, 180);
  assert.equal(envelope.error, undefined);
  let partial = replaceQueryEnvelope('key', undefined, candidate(200, ['a']));
  assert.equal(partial.record?.consistent, false);
  assert.equal(partial.record?.complete, false);
  assert.equal(partial.record?.unknownRelations, true);
  partial = replaceQueryEnvelope('key', partial, candidate(220, ['b']));
  assert.equal(partial.record?.scannedAt, 220);
  partial = replaceQueryEnvelope('key', partial, candidate(240));
  assert.equal(partial.record?.consistent, true);
  const incomplete = candidate(260);
  assert.equal(incomplete.kind, 'candidate');
  if (incomplete.kind === 'candidate') {
    const next = replaceQueryEnvelope('key', partial, { ...incomplete, message: { ...incomplete.message, complete: false } });
    assert.equal(next.record?.scannedAt, 260);
    assert.equal(next.record?.consistent, true);
    assert.equal(next.record?.complete, false);
  }
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('scannedAt merges record, structural attempt, and named error only after the request', () => Effect.runPromise(Effect.sync(() => {
  for (const update of [candidate(100), { kind: 'drift' as const, scannedAt: 100, at: new Date(200).toISOString(), changedPaths: ['.'] }, fail(100)]) {
    const prior = replaceQueryEnvelope('key', undefined, update, new Date(300).toISOString());
    assert.equal(queryRequestSatisfied(prior, 100), true);
    assert.equal(queryRequestSatisfied(prior, 101), false, 'publication time cannot satisfy a later request');
  }
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('every failure table row retains its meaning, including identity change before errors', () => Effect.runPromise(Effect.sync(() => {
  assert.deepEqual(classifyQueryRefresh('old', 'new', processResult(undefined, { timedOut: true }), 50, 101, 100), { kind: 'identity-changed' });
  for (const [code, details] of [['SourceChanged', undefined], ['DocumentNotFound', undefined], ['PreimageChanged', 'source-observation']] as const) {
    assert.equal(classifyQueryScan(processResult({ format: 'concord.query-scan/v1', ok: false, scannedAt: 100, code, message: 'changed', ...(details ? { details } : {}) }), 50, 101, 100).kind, 'drift');
  }
  for (const code of ['TraceInvalid', 'RecoveryRequired', 'InvalidConfig', 'UnsafePath', 'PreimageChanged']) {
    const update = classifyQueryScan(processResult({ format: 'concord.query-scan/v1', ok: false, scannedAt: 100, code, message: 'original message' }), 50, 101, 100);
    assert.equal(update.kind, 'failure');
    if (update.kind === 'failure') { assert.equal(update.error.code, code); assert.equal(update.error.message, 'original message'); }
  }
  for (const [fields, code] of [
    [{ timedOut: true }, 'QueryRefreshTimedOut'], [{ outputLimitExceeded: true }, 'QueryRefreshOutputLimit'],
    [{ groupCleanup: { ...processResult().groupCleanup, gone: false } }, 'QueryRefreshCleanupUnconfirmed'],
    [{ exitCode: 1, stdout: 'invalid', stderr: 'stderr detail' }, 'QueryRefreshFailed'],
  ] as const) {
    const update = classifyQueryScan(processResult(success, fields), 50, 101, 100);
    assert.equal(update.kind, 'failure');
    if (update.kind === 'failure') {
      assert.equal(update.error.code, code);
      if (code === 'QueryRefreshTimedOut') { assert.equal(update.error.elapsedMs, 101); assert.equal(update.error.limitMs, 100); }
      if (code === 'QueryRefreshFailed') assert.equal(update.error.message, 'stderr detail');
    }
  }
  assert.equal(classifyQueryScan(processResult(), 50, 101, 100).kind, 'candidate');
  assert.throws(() => decodeQueryScanMessage({ ...success, extra: 'body' }));
  const envelope = replaceQueryEnvelope('key', undefined, candidate(100));
  assert.throws(() => Schema.decodeUnknownSync(QueryCacheEnvelope, { onExcessProperty: 'error' })({ ...envelope, record: { ...envelope.record, extra: 'body' } }));
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('owner and remote bodies are stripped and restored only after safe matching reads', () => Effect.runPromise(Effect.sync(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-query-bodies-')));
  const source = renderDocument({ format: 'concord.document/v1', kind: 'feature', id: 'sample', title: 'Sample', createdAt: '2026-10-06T00:00:00.000Z' }, '# PRIVATE_OWNER_BODY\n');
  const path = 'sample.md';
  writeFileSync(join(root, path), source);
  const owner = { path, metadata: { format: 'concord.document/v1', kind: 'feature', id: 'sample', title: 'Sample', createdAt: '2026-10-06T00:00:00.000Z' }, body: '# PRIVATE_OWNER_BODY\n', digest: digest(source) };
  try {
    const stored = stripQueryBodies({ operation: 'trace-show', subject: owner, relatedPaths: [], incoming: [], outgoing: [], tests: [], codeDeclarations: [], cache: value.cache });
    assert.ok(!JSON.stringify(stored).includes('PRIVATE_OWNER_BODY'));
    const matched = hydrateQueryValue(root, stored);
    assert.equal(matched.bodyChanged.length, 0);
    assert.ok(JSON.stringify(matched.value).includes('PRIVATE_OWNER_BODY'));
    writeFileSync(join(root, path), source + '\nchanged\n');
    const changed = hydrateQueryValue(root, stored);
    assert.deepEqual(changed.bodyChanged, [path]);
    assert.ok(!JSON.stringify(changed.value).includes('PRIVATE_OWNER_BODY'));
    rmSync(join(root, path));
    const missing = hydrateQueryValue(root, stored);
    assert.deepEqual(missing.bodyUnavailable, [{ path, code: 'BodyUnavailable' }]);
    assert.throws(() => Schema.decodeUnknownSync(TraceShowValue, { onExcessProperty: 'error' })({ ...stored, subject: owner }));
    const metadata = { format: 'concord.document/v1' as const, kind: 'issue' as const, id: 'remote', title: 'Remote', createdAt: '2026-10-06T00:00:00.000Z', state: 'draft' as const,
      memoryRelations: [], adoptions: { current: [], history: [] }, history: [],
      source: { provider: 'github' as const, instance: 'https://api.github.com' as const, id: '123', url: 'https://github.com/example/example/issues/1', title: 'Remote', body: 'PRIVATE_REMOTE_BODY', state: 'open', updatedAt: '2026-10-06T00:00:00.000Z', connectionId: 'github', importedAt: '2026-10-06T00:00:00.000Z' } };
    const remoteSource = renderDocument(metadata, '# PRIVATE_ISSUE_BODY\n');
    const remote = stripQueryBodies({ operation: 'trace-show', subject: { path, metadata, body: '# PRIVATE_ISSUE_BODY\n', digest: digest(remoteSource) }, relatedPaths: [], incoming: [], outgoing: [], tests: [], codeDeclarations: [], cache: value.cache });
    assert.doesNotMatch(JSON.stringify(remote), /PRIVATE_(REMOTE|ISSUE)_BODY/u);
    assert.match(JSON.stringify(hydrateQueryValue(root, remote, () => remoteSource).value), /PRIVATE_REMOTE_BODY/u);
    const constitution = '---\nformat: concord.constitution/v1\nstatus: draft\nratifiedAt: null\namendedAt: 2026-10-06\namendments: []\n---\n# PRIVATE_CONSTITUTION_BODY\n';
    const matchedReview = hydrateQueryValue(root, { segments: [{ text: 'before\n' }, { constitution: { path, digest: digest(constitution) } }, { text: '\nafter' }] }, () => constitution).value;
    assert.ok('body' in matchedReview);
    assert.equal(matchedReview.body, 'before\n# PRIVATE_CONSTITUTION_BODY\nafter');
    const review = { segments: [{ text: 'before\n' }, { constitution: { path, digest: digest(source) } }, { text: '\nafter' }] };
    assert.deepEqual(hydrateQueryValue(root, review, () => source + 'changed').bodyChanged, [path]);
    const rendered = hydrateQueryValue(root, review, () => source + 'changed').value;
    assert.ok('body' in rendered);
    assert.match(rendered.body, /constitution changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('real code scanner distinguishes unstable recompilation from stable deletion of every file', () => Effect.runPromise(Effect.sync(() => {
  for (const unstable of [false, true]) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-code-unknown-')));
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial, false, { sourceRoots: ['src'], testRoots: [] }); } finally { initial.close(); }
    mkdirSync(join(root, 'src'));
    const path = 'src/sample.ts';
    const source = '// @concord-file\n// @concord-implements docs/feature/sample/README.md\nexport const old = 1;\n';
    writeFileSync(join(root, path), source);
    const local = new LocalRepository(root, { access: 'read', dryRun: true });
    let passes = 0;
    const repo: Repository = {
      root: local.root, privateDir: local.privateDir, config: local.config, configSnapshot: local.configSnapshot,
      absolute: relative => local.absolute(relative), read: relative => local.read(relative),
      files: prefix => {
        if (prefix === 'src') {
          passes++;
          if (passes === 2) {
            if (unstable) writeFileSync(join(root, path), source.replace('old', 'second'));
            else rmSync(join(root, path));
          } else if (passes === 3 && unstable) writeFileSync(join(root, path), source.replace('old', 'third'));
        }
        return local.files(prefix);
      },
      publish: () => { throw new Error('Source scanner has no publication authority'); },
    };
    try {
      const snapshot = local.observeProjection(() => scanCode(repo, { cache: 'off' })).value;
      assert.deepEqual(snapshot.codes, []);
      assert.equal(snapshot.relationsUnknown, unstable);
      assert.equal(passes, 3);
      assert.ok(snapshot.findings.some(finding => finding.code === 'CodeSourceChanged'));
    } finally { local.close(); rmSync(root, { recursive: true, force: true }); }
  }
})));
