import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

const cli = resolve('dist/entry.js');
const run = (root: string, args: readonly string[], status = 0, input = ''): string => {
  const output = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(output.status, status, JSON.stringify({ args, stdout: output.stdout, stderr: output.stderr, error: output.error }));
  return output.stdout || output.stderr;
};
const fileDigest = (root: string, path: string): string => `sha256:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}`;
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
const lineOf = (root: string, path: string, needle: string) => read(root, path).split('\n').findIndex(text => text.includes(needle)) + 1;
const withConsumer = (name: string, body: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), `concord-constitution-${name}-`));
  try { execFileSync('git', ['init', '-q', root]); run(root, ['init', '--docs-only']); body(root); }
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
  run(root, ['feature', 'create', 'cart', '--title', 'Cart', '--pages', 'architecture']);
  run(root, ['use-case', 'create', 'checkout', '--feature', 'cart', '--title', 'Checkout']);
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
  run(root, ['issue', 'create', 'preimage-gap', '--title', 'Preimage gap', '--body', bodyFile]);
  const issue = 'docs/issues/preimage-gap.md';
  const reduced = rules('1. Writes keep edits. {#c-001-1}\n');
  const refused = amend(root, reduced, 1);
  assert.match(refused, /ConstitutionClauseReferenced/);
  assert.match(refused, new RegExp(`${issue}:${lineOf(root, issue, '#c-001-2')}`, 'u'));
  writeFileSync(bodyFile, '# Preimage gap\n\nA write skipped its preimage check.\n');
  run(root, ['issue', 'edit', 'preimage-gap', '--body', bodyFile, '--expected-digest', fileDigest(root, issue)]);
  amend(root, reduced);
  run(root, ['check']);
}))));

const legacyConstitution = `---
format: concord.constitution/v1
status: active
ratifiedAt: 2026-01-01
amendedAt: 2026-01-01
amendments:
  - date: 2026-01-01
    reason: Adopt
    sources: []
    impact: All pages
---

# Constitution

## 总则

**Scope.** Rules apply to docs.

<a id="c-001"></a>
## C-001 Preserve data

1. Writes keep edits.
2. Writes check
   preimages.

<a id="c-002"></a>
## C-002 Stay local

1. No services.
`;
const withRefs = (root: string, path: string, refs: readonly string[]) => writeFileSync(join(root, path), read(root, path).replace(/\n---\n/u, `\nconstitutionRefs:${refs.length === 0 ? ' []' : refs.map(ref => `\n  - docs/constitution.md#${ref}`).join('')}\n---\n`));
const legacyConsumer = (root: string) => {
  run(root, ['feature', 'create', 'alpha', '--title', 'Alpha']);
  run(root, ['feature', 'create', 'beta', '--title', 'Beta']);
  run(root, ['feature', 'create', 'gamma', '--title', 'Gamma']);
  run(root, ['design', 'create', 'delta', '--title', 'Delta', '--alternative', 'one', '--alternative', 'two']);
  appendFileSync(join(root, 'docs/feature/alpha/README.md'), '\nLocal only ([C-002](../../constitution.md#c-002)).\n');
  appendFileSync(join(root, 'docs/feature/beta/README.md'), '\n## Constitution\n\nExisting note.\n\n## Later\n\nText.\n');
  withRefs(root, 'docs/feature/alpha/README.md', ['c-001', 'c-002']);
  withRefs(root, 'docs/feature/beta/README.md', ['c-001']);
  withRefs(root, 'docs/feature/gamma/README.md', []);
  withRefs(root, 'docs/design/delta/README.md', ['c-001']);
  writeFileSync(join(root, 'docs/constitution.md'), legacyConstitution);
};
const MigrateView = Schema.Struct({ operation: Schema.Literal('constitution-migrate'), dryRun: Schema.Boolean, changedPaths: Schema.Array(Schema.String), clauses: Schema.Number, paragraphs: Schema.Number, movedReferences: Schema.Number });
const migrate = (root: string, args: readonly string[] = []) => Schema.decodeUnknownSync(Schema.fromJsonString(MigrateView))(run(root, [...args, 'constitution', 'migrate']));

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#迁移旧格式
test('migration converts v1 IDs and constitutionRefs into body links once, refusing conflicts without writes', () => Effect.runPromise(Effect.sync(() => withConsumer('migrate', root => {
  legacyConsumer(root);
  const legacy = findings(run(root, ['check'], 1)).map(item => `${item.code}:${item.path}`);
  assert.ok(legacy.includes('ConstitutionMigrationRequired:docs/constitution.md'));
  assert.ok(legacy.includes('ConstitutionMigrationRequired:docs/feature/gamma/README.md'));
  assert.match(run(root, ['feature', 'show', 'docs/feature/alpha/README.md'], 1), /ConstitutionMigrationRequired/);
  const beta = 'docs/feature/beta/README.md';
  appendFileSync(join(root, beta), '\n## Constitution\n\nSecond section.\n');
  const snapshot = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  const sources = ['docs/constitution.md', beta, 'docs/feature/alpha/README.md'].map(path => read(root, path));
  assert.match(run(root, ['constitution', 'migrate'], 1), /ConstitutionMigrationConflict/);
  assert.deepEqual(['docs/constitution.md', beta, 'docs/feature/alpha/README.md'].map(path => read(root, path)), sources);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }), snapshot);
  writeFileSync(join(root, beta), read(root, beta).replace('\n## Constitution\n\nSecond section.\n', ''));
  const preview = migrate(root, ['--dry-run']);
  assert.equal(preview.dryRun, true);
  assert.equal(read(root, 'docs/constitution.md'), legacyConstitution);
  const changed = ['docs/constitution.md', 'docs/design/delta/README.md', 'docs/feature/alpha/README.md', beta, 'docs/feature/gamma/README.md'];
  assert.deepEqual(migrate(root), { operation: 'constitution-migrate', dryRun: false, changedPaths: changed, clauses: 2, paragraphs: 3, movedReferences: 4 });
  assert.deepEqual(preview.changedPaths, changed);
  const constitution = read(root, 'docs/constitution.md');
  assert.match(constitution, /format: concord\.constitution\/v2/);
  assert.match(constitution, /^## 总则 \{#general\}$/mu);
  assert.match(constitution, /^## C-001 Preserve data \{#c-001\}\n\n1\. Writes keep edits\. \{#c-001-1\}\n2\. Writes check\n {3}preimages\. \{#c-001-2\}$/mu);
  assert.match(constitution, /^1\. No services\. \{#c-002-1\}$/mu);
  assert.doesNotMatch(constitution, /<a id=/u);
  assert.match(constitution, /reason: Adopt/);
  const alpha = read(root, 'docs/feature/alpha/README.md');
  assert.doesNotMatch(alpha, /constitutionRefs/);
  assert.match(alpha, /\n## Constitution\n\n- \[C-001\]\(\.\.\/\.\.\/constitution\.md#c-001\)\n$/u);
  assert.match(read(root, beta), /## Constitution\n\nExisting note\.\n\n- \[C-001\]\(\.\.\/\.\.\/constitution\.md#c-001\)\n\n## Later\n/u);
  assert.doesNotMatch(read(root, 'docs/feature/gamma/README.md'), /constitutionRefs|## Constitution/u);
  assert.match(read(root, 'docs/design/delta/README.md'), /- \[C-001\]\(\.\.\/\.\.\/constitution\.md#c-001\)/u);
  run(root, ['check']);
  const owners = new Set(show(root).references.map(reference => `${reference.path}#${reference.clause}`));
  for (const expected of ['docs/feature/alpha/README.md#c-001', 'docs/feature/alpha/README.md#c-002', `${beta}#c-001`, 'docs/design/delta/README.md#c-001']) assert.ok(owners.has(expected), expected);
  const after = changed.map(path => read(root, path));
  assert.deepEqual(migrate(root).changedPaths, []);
  assert.deepEqual(changed.map(path => read(root, path)), after);
}))));

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#迁移旧格式
test('interrupted migration keeps the journal, blocks ordinary commands and recovers', () => Effect.runPromise(Effect.sync(() => withConsumer('migrate-recover', root => {
  legacyConsumer(root);
  const blocked = join(root, 'docs/feature/beta');
  chmodSync(blocked, 0o555);
  try { assert.match(run(root, ['constitution', 'migrate'], 1), /RecoveryRequired/); }
  finally { chmodSync(blocked, 0o755); }
  assert.match(read(root, 'docs/constitution.md'), /concord\.constitution\/v2/);
  assert.match(run(root, ['check'], 1), /RecoveryRequired/);
  run(root, ['recover']);
  migrate(root);
  run(root, ['check']);
  assert.deepEqual(migrate(root).changedPaths, []);
}))));
