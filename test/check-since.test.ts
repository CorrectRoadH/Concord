import { createConsumer } from './support/consumer.js';
import { gitCommit } from './support/fix-consumer.js';
import { LocalRepository } from "../src/base/workspace/index.js";
import { createDocument } from "../src/domain/documents/index.js";
import { OwnedProcessLive } from "../src/base/process/index.js";
import { checkSince } from "../src/app/index.js";
import { Effect } from 'effect';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectEndpointEvents } from "../src/app/index.js";
import { renderDocument } from "../src/model/index.js";
import { initialConstitution } from "../src/domain/constitution/index.js";
import { digest, type DocumentMeta, type Repository } from "../src/model/index.js";

/** Captured domain input, not a second implementation of Git or transition rules. */
function sources(input: Readonly<Record<string, string>>): Repository {
  return { root: '/captured', privateDir: '/captured/.git/concord', access: 'read', persistentCache: 'off', config: { testRoots: [], sourceRoots: [] }, configSnapshot: { path: 'concord.config.ts', source: '', digest: digest(''), config: {} }, read: path => input[path], files: prefix => Object.keys(input).filter(path => path === prefix || path.startsWith(`${prefix}/`)), absolute: path => `/captured/${path}`, publish: () => { throw new Error('Captured inputs cannot publish'); } };
}
const meta = { format: 'concord.document/v1' as const, id: 'a', title: 'A' };
const memory = (status: 'captured' | 'current' | 'superseded', type: 'decision' | 'insight' | 'note' = 'insight', relations: readonly { role: 'amends' | 'supports'; target: string }[] = []) => renderDocument({ ...meta, kind: 'memory', type, status, relations, ...(status === 'superseded' ? { supersededBy: 'memory/b.md' } : {}) }, '# A\n');
const codes = (before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>) => inspectEndpointEvents(sources(before), sources(after)).findings.map(finding => finding.code);

// @feature docs/feature/local-sdlc/cli.md#检查本次变化
test('endpoint Memory events allow captured→current→superseded and reject every reverse or skipped transition', () => {
  for (const [from, to, expected] of [
    ['captured', 'current', []], ['current', 'superseded', []],
    ['current', 'captured', ['InvalidMemoryState']], ['captured', 'superseded', ['InvalidMemoryState']],
    ['superseded', 'current', ['InvalidMemoryState']], ['superseded', 'captured', ['InvalidMemoryState']],
  ] as const) assert.deepEqual(codes({ 'memory/a.md': memory(from) }, { 'memory/a.md': memory(to) }), expected, `${from}→${to}`);
});

// @feature docs/feature/local-sdlc/cli.md#检查本次变化
test('only new fixed closures or changed verification replay, while unchanged records and reason edits stay recorded', () => {
  const verification = { defect: 'a'.repeat(40), fix: 'b'.repeat(40), tests: ['neref_' + 'c'.repeat(32)] as [string], runner: digest('runner'), concord: 'dev' };
  const issue = (status: 'open' | 'closed', closure?: Extract<DocumentMeta, { kind: 'issue' }>['closure']) => renderDocument({ ...meta, kind: 'issue', status, relations: [], ...(closure ? { closure } : {}) }, '# A\n');
  const fixed = issue('closed', { kind: 'fixed', reason: 'Corrected', verification });
  const inspect = (before: string, after: string) => inspectEndpointEvents(sources({ 'docs/issues/a.md': before }), sources({ 'docs/issues/a.md': after })).replays;
  assert.deepEqual(inspect(issue('open'), fixed), ['docs/issues/a.md']);
  assert.deepEqual(inspect(issue('closed', { kind: 'closed', reason: 'Reviewed' }), fixed), ['docs/issues/a.md']);
  assert.deepEqual(inspect(fixed, fixed), []);
  assert.deepEqual(inspect(fixed, issue('closed', { kind: 'fixed', reason: 'Better reason', verification })), []);
  assert.deepEqual(inspect(fixed, issue('closed', { kind: 'fixed', reason: 'Corrected', verification: { ...verification, fix: 'd'.repeat(40) } })), ['docs/issues/a.md']);
});

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
test('active constitution amendment requires a new Decision for each affected ID, including deleted paragraphs', () => {
  const body = '# Constitution\n\n## C-001 Source {#c-001}\n\n1. Keep source. {#c-001-1}\n2. Keep history. {#c-001-2}\n';
  const active = (body: string) => initialConstitution({ body, active: true, reason: 'Adopt', impact: 'Local', sources: ['Requirements'] }).source;
  const before = { 'docs/constitution.md': active(body) };
  const changed = { 'docs/constitution.md': active(body.replace('Keep source.', 'Preserve source.').replace('2. Keep history. {#c-001-2}\n', '')) };
  assert.deepEqual(codes(before, changed), ['ConstitutionDecisionRequired', 'ConstitutionDecisionRequired']);
  const decision = renderDocument({ ...meta, kind: 'memory', type: 'decision', status: 'current', relations: [{ role: 'amends', target: 'docs/constitution.md#c-001-1' }, { role: 'amends', target: 'docs/constitution.md#c-001-2' }] }, '# Decision\n\n## 适用范围\n\nLocal.\n\n## 理由\n\nRequired.\n\n## 来源\n\nRequirements.\n\n## 影响\n\nLocal rules.\n');
  assert.deepEqual(codes(before, { ...changed, 'memory/decision.md': decision }), []);
  assert.deepEqual(codes({ ...before, 'memory/decision.md': decision }, { ...changed, 'memory/decision.md': decision }), ['ConstitutionDecisionRequired', 'ConstitutionDecisionRequired']);
  assert.deepEqual(codes(before, {}), ['InvalidConstitutionTransition']);
});

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md
test('constitution activation requires a newly added Decision amending the root', () => {
  const body = '# Constitution\n\n## C-001 Source {#c-001}\n\n1. Keep source. {#c-001-1}\n';
  const draft = initialConstitution({ body }).source;
  const adopted = initialConstitution({ body, active: true, reason: 'Adopt', impact: 'Local', sources: ['Requirements'] });
  assert.deepEqual(codes({ 'docs/constitution.md': draft }, { 'docs/constitution.md': adopted.source }), ['ConstitutionDecisionRequired']);
  assert.deepEqual(codes({ 'docs/constitution.md': draft }, { 'docs/constitution.md': adopted.source, [adopted.decision!.path]: adopted.decision!.after! }), []);
  assert.deepEqual(codes({ 'docs/constitution.md': adopted.source }, { 'docs/constitution.md': draft }), ['InvalidConstitutionTransition']);
});

// @feature docs/feature/local-sdlc/cli.md#检查本次变化
test('deleting a Memory refuses inbound owner Markdown links', () => {
  const before = { 'memory/a.md': memory('current') };
  assert.deepEqual(codes(before, { 'docs/feature/a/README.md': '# A\n\n[Memory](../../../memory/a.md)\n' }), ['ReferenceNotFound']);
  assert.deepEqual(codes(before, {}), []);
});

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('decided Designs freeze choices, candidate goals and root constraints while allowing dated sourced rationale additions', () => {
  const plan = '# A\n\n## Goals\n\nLocal queries.\n\n## Limits\n\nOffline.\n\n## Cases\n\nBasic.\n';
  const before = {
    'docs/design/store/README.md': '# Store\n', 'docs/design/store/plans/a.md': plan,
    'docs/design/store/GOALS.md': '# Goals\n\nLocal.\n', 'docs/design/store/LIMITS.md': '# Limits\n\nOffline.\n',
    'docs/design/store/DECISION.md': '# Decision\n\n## Decision\n\nSelected: [a](plans/a.md)\n\n## Rationale\n\nLocal storage.\n',
  };
  assert.deepEqual(codes(before, before), []);
  assert.deepEqual(codes(before, { ...before, 'docs/design/store/plans/a.md': plan.replace('Local queries.', 'Remote queries.') }), ['DesignDecisionImmutable']);
  assert.deepEqual(codes(before, { ...before, 'docs/design/store/GOALS.md': '# Goals\n\nRemote.\n' }), ['DesignDecisionImmutable']);
  assert.deepEqual(codes(before, { ...before, 'docs/design/store/DECISION.md': '# Decision\n' }), ['DesignDecisionImmutable', 'DesignDecisionImmutable']);
  assert.deepEqual(codes(before, { ...before, 'docs/design/store/plans/b.md': '# B\n' }), ['DesignDecisionImmutable']);
  const date = 'docs/design/store/DECISION.md';
  assert.deepEqual(codes(before, { ...before, [date]: before[date] + '\n### Correction 2026-10-30\n\nSource: Requirements.\n\nClarified scope.\n' }), []);
  assert.deepEqual(codes(before, { ...before, [date]: before[date].replace('Local storage.', 'Different reason.') }), ['DesignDecisionImmutable']);
  const { 'docs/design/store/plans/a.md': _a, ...rest } = before;
  assert.deepEqual(codes(before, { ...rest, 'docs/design/store/plans/a/README.md': plan, [date]: before[date].replace('plans/a.md', 'plans/a/README.md') }), []);
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
test('Roadmap movement validates the moved content and both link directions', () => {
  const before = {
    'docs/roadmap/store/README.md': '# Store\n\n[Peer](../../feature/peer/README.md)\n',
    'docs/feature/peer/README.md': '# Peer\n\n[Plan](../../roadmap/store/README.md)\n',
  };
  const after = {
    'docs/feature/store/README.md': '# Store\n\n[Peer](../peer/README.md)\n',
    'docs/feature/peer/README.md': '# Peer\n\n[Plan](../store/README.md)\n',
  };
  assert.deepEqual(codes(before, after), []);
  assert.deepEqual(codes(before, { ...after, 'docs/feature/peer/README.md': before['docs/feature/peer/README.md'] }), ['InvalidRoadmapAdoption']);
  assert.deepEqual(codes(before, { ...after, 'docs/feature/store/README.md': before['docs/roadmap/store/README.md'] }), ['InvalidRoadmapAdoption']);
});

// @feature docs/feature/local-sdlc/cli.md#检查本次变化
test('since accepts an ancestor with no optional project configuration', async () => {
  const root = createConsumer();
  try {
    const base = gitCommit(root, 'baseline without config');
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'feature', { id: 'scope', title: 'Scope' }); } finally { repo.close(); }
    const result = await Effect.runPromise(checkSince(root, base).pipe(Effect.provide(OwnedProcessLive)));
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true); assert.deepEqual(result.findings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
