import { createConsumer } from './support/consumer.js';
import { LocalRepository } from "../src/base/workspace/index.js";
import { editKnowledge } from "../src/domain/issues/index.js";
import { installedConcordCli, writeProjectConfig } from './support.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

const cli = installedConcordCli();
const run = (root: string, args: readonly string[], status = 0, input = ''): string => {
  const output = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(output.status, status, JSON.stringify({ args, stdout: output.stdout, stderr: output.stderr, error: output.error }));
  return output.stdout || output.stderr;
};
const fileDigest = (root: string, path: string): string => `sha256:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}`;
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
const lineOf = (root: string, path: string, needle: string) => read(root, path).split('\n').findIndex(text => text.includes(needle)) + 1;
const withConsumer = (name: string, body: (root: string) => void): void => {
  const root = createConsumer();
  try { writeProjectConfig(root, { testRoots: [] }); body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};
const Finding = Schema.Struct({ code: Schema.String, path: Schema.optional(Schema.String), line: Schema.optional(Schema.Number) });
const findings = (output: string) => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ findings: Schema.Array(Finding) })), { onExcessProperty: 'ignore' })(output).findings;
const Reference = Schema.Struct({ path: Schema.String, line: Schema.Number, clause: Schema.String, paragraph: Schema.NullOr(Schema.String) });
const ShowView = Schema.Struct({ references: Schema.Array(Reference), complete: Schema.Boolean });
const show = (root: string) => Schema.decodeUnknownSync(Schema.fromJsonString(ShowView), { onExcessProperty: 'ignore' })(run(root, ['constitution', 'show']));
const adopt = (root: string, body: string) => run(root, ['action', '--input', '-'], 0, JSON.stringify({ action: 'constitution.adopt', body, reason: 'Adopt rules', impact: 'All pages', sources: [], expectedDigest: fileDigest(root, 'docs/constitution.md') }));
const amend = (root: string, body: string, status = 0) => run(root, ['action', '--input', '-'], status, JSON.stringify({ action: 'constitution.amend', body, reason: 'Revise rules', impact: 'Linked pages', sources: [], expectedDigest: fileDigest(root, 'docs/constitution.md') }));
const rules = (paragraphs = '1. Writes keep edits. {#c-001-1}\n2. Writes check preimages. {#c-001-2}\n') => `# Constitution\n\n## 总则 {#general}\n\nRules apply to docs.\n\n## C-001 Preserve data {#c-001}\n\n${paragraphs}`;

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#link-clause
test('only scheme-less inline links that resolve to the constitution are references, on every docs page', () => Effect.runPromise(Effect.sync(() => withConsumer('scope', root => {
  adopt(root, rules());
  run(root, ['new', 'feature', 'cart', '--title', 'Cart', '--pages', 'architecture']);
  run(root, ['new', 'use-case', 'checkout', '--feature', 'cart', '--title', 'Checkout']);
  const feature = 'docs/feature/cart/README.md', page = 'docs/feature/cart/architecture.md', useCase = 'docs/feature/cart/use-case/checkout.md';
  appendFileSync(join(root, feature), [
    '', 'Whole file [rules](../../constitution.md) and a clause [C-001](../../constitution.md#c-001).',
    'External [copy](https://example.com/constitution.md#c-404) is ignored.',
    '![image](../../constitution.md#c-404)', '',
    'Reference [style][rule] is ignored.', '', '[rule]: ../../constitution.md#c-404', '',
    'Code `[x](../../constitution.md#c-404)` is ignored.', '',
    '```markdown', '[y](../../constitution.md#c-404)', '```', '',
  ].join('\n'));
  appendFileSync(join(root, page), '\nThe writer keeps edits ([C-001](../../constitution.md#c-001-1)).\n');
  appendFileSync(join(root, useCase), '\nCheckout keeps edits ([C-001](../../../constitution.md#c-001-1)).\n');
  run(root, ['check']);
  const view = show(root);
  assert.equal(view.complete, true);
  assert.deepEqual(view.references, [
    { path: feature, line: lineOf(root, feature, '#c-001)'), clause: 'c-001', paragraph: null },
    { path: page, line: lineOf(root, page, '#c-001-1'), clause: 'c-001', paragraph: 'c-001-1' },
    { path: useCase, line: lineOf(root, useCase, '#c-001-1'), clause: 'c-001', paragraph: 'c-001-1' },
  ]);
  assert.match(run(root, ['trace', 'show', feature]), /docs\/feature\/cart\/architecture\.md[\s\S]*docs\/constitution\.md#c-001-1/);
  appendFileSync(join(root, feature), '\nQuery [rule](../../constitution.md?x#c-001).\n');
  const query = findings(run(root, ['check'], 1));
  assert.deepEqual(query.map(item => ({ code: item.code, path: item.path, line: item.line })), [{ code: 'ConstitutionLinkInvalid', path: feature, line: lineOf(root, feature, '?x#c-001') }]);
  writeFileSync(join(root, feature), read(root, feature).replace('?x#c-001', '#c-%ZZ'));
  const encoded = findings(run(root, ['check'], 1));
  assert.deepEqual(encoded.map(item => item.code), ['ConstitutionLinkInvalid']);
  assert.equal(show(root).complete, false);
  assert.match(amend(root, rules('1. Writes keep edits. {#c-001-1}\n2. Writes check preimages. {#c-001-2}\n3. Writes are scoped. {#c-001-3}\n'), 1), /ConstitutionLinkInvalid/);
  writeFileSync(join(root, feature), read(root, feature).replace('#c-%ZZ', '#c-001'));
  run(root, ['check']);
}))));

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
test('amendment lists Issue references to a removed paragraph until the Issue is edited', () => Effect.runPromise(Effect.sync(() => withConsumer('issue', root => {
  adopt(root, rules());
  const bodyFile = join(root, 'issue-body.md');
  writeFileSync(bodyFile, '# Preimage gap\n\nA write skipped its preimage check ([C-001](../constitution.md#c-001-2)).\n');
  run(root, ['new', 'issue', 'preimage-gap', '--title', 'Preimage gap', '--body', bodyFile]);
  const issue = 'docs/issues/preimage-gap.md';
  const reduced = rules('1. Writes keep edits. {#c-001-1}\n');
  const refused = amend(root, reduced, 1);
  assert.match(refused, /ConstitutionClauseReferenced/);
  assert.match(refused, new RegExp(`${issue}:${lineOf(root, issue, '#c-001-2')}`, 'u'));
  writeFileSync(bodyFile, '# Preimage gap\n\nA write skipped its preimage check.\n');
  const repository = new LocalRepository(root);
  try { editKnowledge(repository, 'issue', issue, readFileSync(bodyFile, 'utf8'), fileDigest(root, issue)); } finally { repository.close(); }
  amend(root, reduced);
  run(root, ['check']);
}))));

const Receipt = Schema.Struct({ memory: Schema.String });
const memoryPath = (output: string) => Schema.decodeUnknownSync(Schema.fromJsonString(Receipt), { onExcessProperty: 'ignore' })(output).memory;

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
test('adopt and amend record their reason as a current Decision promoted to the changed paragraphs', () => Effect.runPromise(Effect.sync(() => withConsumer('decision', root => {
  const adopted = memoryPath(adopt(root, rules()));
  assert.match(read(root, 'docs/constitution.md'), /^---\nstatus: active\n---\n/u);
  assert.match(adopted, /^memory\/constitution-\d{4}-\d{2}-\d{2}-1\.md$/u);
  const decision = read(root, adopted);
  assert.match(decision, /type: decision\nstatus: current/u);
  assert.match(decision, /relations:\n {2}- role: amends\n {4}target: docs\/constitution\.md\n/u);
  assert.match(decision, /## 理由\n\nAdopt rules\n\n## 影响\n\nAll pages\n/u);
  const amended = memoryPath(amend(root, rules('1. Writes keep edits. {#c-001-1}\n2. Writes check every preimage. {#c-001-2}\n')));
  assert.notEqual(amended, adopted);
  assert.match(read(root, amended), /relations:\n {2}- role: amends\n {4}target: docs\/constitution\.md#c-001-2\n/u);
  assert.doesNotMatch(read(root, 'docs/constitution.md'), /amend|ratified/u);
  run(root, ['check']);
}))));


// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md
test('non-current constitutions and declarative history fields fail strict decoding without rewriting owners', () => Effect.runPromise(Effect.sync(() => withConsumer('invalid-format', root => {
  const path = 'docs/constitution.md';
  const current = read(root, path);
  for (const source of [current.replace('status: draft', 'format: concord.constitution/v3\nstatus: draft'), current.replace('status: draft', 'format: concord.constitution/v2\nstatus: draft'), current.replace('status: draft', 'status: draft\namendments: []')]) {
    writeFileSync(join(root, path), source);
    assert.match(run(root, ['constitution', 'show'], 1), /InvalidData/);
    assert.equal(read(root, path), source);
  }
  writeFileSync(join(root, path), current);
  run(root, ['new', 'feature', 'cart', '--title', 'Cart']);
  run(root, ['new', 'use-case', 'checkout', '--feature', 'cart', '--title', 'Checkout']);
  run(root, ['new', 'engineering', 'build', '--title', 'Build']);
  for (const owner of ['docs/feature/cart/README.md', 'docs/feature/cart/use-case/checkout.md', 'docs/engineering/build/README.md']) {
    const original = read(root, owner);
    for (const field of ['createdAt: 2026-01-01', 'createdAtSource: {}', 'origin: docs/roadmap/cart/README.md', 'constitutionRefs: []']) {
      const source = `---\n${field}\n---\n\n${original}`;
      writeFileSync(join(root, owner), source);
      assert.ok(findings(run(root, ['check'], 1)).some(finding => finding.path === owner && finding.code === 'InvalidData'), field);
      assert.equal(read(root, owner), source);
    }
    writeFileSync(join(root, owner), original);
  }
}))));

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
test('amendment promotions include continuation changes and the surviving clause of a removed paragraph', () => Effect.runPromise(Effect.sync(() => withConsumer('continuation', root => {
  adopt(root, rules('1. Preserve edits. {#c-001-1}\n\n   Keep the original bytes.\n2. Check preimages. {#c-001-2}\n'));
  const revised = memoryPath(amend(root, rules('1. Preserve edits. {#c-001-1}\n\n   Keep the exact original bytes.\n2. Check preimages. {#c-001-2}\n')));
  assert.match(read(root, revised), /relations:\n {2}- role: amends\n {4}target: docs\/constitution\.md#c-001-1\n/u);
  const reduced = memoryPath(amend(root, rules('1. Preserve edits. {#c-001-1}\n\n   Keep the exact original bytes.\n')));
  assert.match(read(root, reduced), /relations:\n {2}- role: amends\n {4}target: docs\/constitution\.md#c-001\n/u);
  run(root, ['check']);
}))));
