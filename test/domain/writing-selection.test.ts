import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { renderWritingPolicy } from '../../src/model/index.ts';
import { executeQuery } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { query, action } from '../support/application-fixture.ts';

const Report = Schema.Struct({ selection: Schema.Array(Schema.String), mode: Schema.String, files: Schema.Int, findings: Schema.Array(Schema.Struct({ file: Schema.String, rule: Schema.String })) });

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('docs selection checks files and directories with inherited rules and limits unused concepts to selected catalogs', async () => {
  const root = await createConsumer();
  try {
    mkdirSync(join(root, 'docs/guide'), { recursive: true });
    writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy({ roots: ['docs'], bannedTerms: [{ term: 'bad', use: 'clear', why: 'precision' }] }));
    writeFileSync(join(root, 'docs/concepts.md'), '# Terms\n\n## Unused {#unused}\n\nOutside selection.\n');
    writeFileSync(join(root, 'docs/guide/concepts.md'), '# Terms\n\n## Local {#local}\n\nLocal meaning.\n');
    writeFileSync(join(root, 'docs/guide/writing.md'), renderWritingPolicy({ bannedTerms: [{ term: 'old', use: 'new', why: 'local' }] }));
    writeFileSync(join(root, 'docs/guide/page.md'), 'bad old\n');
    writeFileSync(join(root, 'docs/figure.svg'), '<svg><text>bad</text></svg>');
    writeFileSync(join(root, 'outside.md'), 'bad');
    const selected = await query(root, { name: 'docs.check', input: { selection: ['docs/guide/page.md', 'docs/figure.svg'] } }, Report, 1);
    assert.deepEqual(selected.selection, ['docs/figure.svg', 'docs/guide/page.md']);
    assert.equal(selected.mode, 'project');
    assert.equal(selected.files, 2);
    assert.equal(selected.findings.length, 3);
    assert(selected.findings.every(item => item.rule === 'bannedTerm'));
    const directory = await query(root, { name: 'docs.check', input: { selection: ['docs/guide'] } }, Report, 1);
    assert(directory.findings.some(item => item.file === 'docs/guide/concepts.md' && item.rule === 'unusedConcept'));
    assert(!directory.findings.some(item => item.file === 'docs/concepts.md'));
    const structured = await action(root, { action: 'writing.check', selection: ['docs/figure.svg'] }, Report);
    assert.deepEqual(structured.selection, ['docs/figure.svg']);
    for (const [path, code] of [['docs/missing', 'WritingInputNotFound'], ['outside.md', 'WritingInputOutOfScope'], ['../escape', 'UnsafePath']] as const) {
      await assert.rejects(runApplication(executeQuery(root, { name: 'docs.check', input: { selection: [path] } }, 'off')), { code });
    }
    writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy({ roots: ['docs/guide'], bannedTerms: [] }));
    const full = await action(root, { action: 'writing.check' }, Report);
    assert(full.findings.some(item => item.file === 'docs/concepts.md' && item.rule === 'unusedConcept'));
    const narrow = await action(root, { action: 'writing.check', selection: ['docs/guide'] }, Report);
    assert(!narrow.findings.some(item => item.file === 'docs/concepts.md'));
    assert.deepEqual((await action(root, { action: 'writing.check' }, Report)).findings, full.findings);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
