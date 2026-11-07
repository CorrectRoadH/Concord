import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { renderWritingPolicy } from '../../src/model/index.ts';
import { executeQuery } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { query } from '../support/application-fixture.ts';

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('writing checks consumer policy, readable prose and safe input boundaries while excluding SVG', async () => {
 const root = (await createConsumer());
 try {
 const reportSchema = Schema.Struct({ ok: Schema.Boolean, files: Schema.Int, findings: Schema.Array(Schema.Struct({ file: Schema.String, line: Schema.Int, rule: Schema.String, message: Schema.String })) });
 const policy = {
  roots: ['guide', 'guide/page.md'] as [string, ...string[]],
  bannedTerms: [{ term: 'bad', use: 'clear', why: 'Be precise' }, { term: '旧词', use: '新词', why: 'One vocabulary', allowIn: ['旧词典'] }],
  sentenceLength: 20, paragraphLength: 30,
 };
 mkdirSync(join(root, 'guide'));
 writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy(policy));
 writeFileSync(join(root, 'guide/style.css'), '.label { fill: black; }\n');
 writeFileSync(join(root, 'docs/concepts.md'), "# Terms\n\n## 新词 {#new-word}\n\nPreferred wording\n\n旧写法：`旧称`\n");
 writeFileSync(join(root, 'guide/page.md'), [
  '---', 'title: bad', '---', '# Guide', '', '新词 good 旧词典.', '',
  '```ts', 'bad', '```', '', '~~~', 'bad', '~~~', '',
  '``bad ` bad`` [clear](bad) ![bad](image.png)', '', '<!-- bad -->', '',
  'bad BAD badly 旧词 旧称', '', '甲'.repeat(15), '乙'.repeat(20) + '。',
 ].join('\n'));
 writeFileSync(join(root, 'guide/view.mdx'), ['<Panel', ' title="bad"', '>', 'clear', '</Panel>', '{/* GENERATED:BEGIN fields */}', 'bad', '{/* GENERATED:END fields */}'].join('\n'));
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text><desc>bad</desc></svg>');
 const first = (await query(root, { name: 'docs.check', input: {} }, reportSchema, 1));
 assert.equal(first.files, 2);
 assert(first.findings.filter(hit => hit.rule === 'bannedTerm').length >= 4);
 assert.equal(first.findings.filter(hit => hit.rule === 'sentenceLength').length, 1);
 assert.equal(first.findings.filter(hit => hit.rule === 'paragraphLength').length, 1);
 assert(first.findings.some(hit => hit.file === 'guide/page.md' && hit.line === 22));
 assert(!first.findings.some(hit => hit.rule === 'unusedConcept' || hit.rule === 'svgTerm' || hit.rule === 'svgStyle'));
 writeFileSync(join(root, 'guide/page.md'), '新词 good 旧词典.\n');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text></svg>');
 assert.equal((await query(root, { name: 'docs.check', input: {} }, reportSchema)).ok, true);
 mkdirSync(join(root, 'guide/exempt-more'));
 writeFileSync(join(root, 'guide/exempt-more/page.md'), 'bad');
 assert((await query(root, { name: 'docs.check', input: {} }, reportSchema, 1)).findings.some(hit => hit.file === 'guide/exempt-more/page.md'));
 rmSync(join(root, 'guide/exempt-more'), { recursive: true });
 writeFileSync(join(root, 'guide/page.md'), 'clear');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><text class="label">幽灵</text></svg>');
 const missing = (await query(root, { name: 'docs.check', input: {} }, reportSchema, 1));
 assert(missing.findings.some(hit => hit.rule === 'unusedConcept'));
 assert(!missing.findings.some(hit => hit.file.endsWith('.svg')));
 writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy({ ...policy, roots: ['missing'] }));
 await assert.rejects(runApplication(executeQuery(root, { name: 'docs.check', input: {} }, 'off')), { code: 'WritingInputNotFound' });
 writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 await assert.rejects(runApplication(executeQuery(root, { name: 'docs.check', input: {} }, 'off')), { code: 'UnsafePath' });
 } finally { rmSync(root, { recursive: true, force: true }); }
});
