import { renderWritingPolicy } from '../../src/model/index.js';
import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('packed writing checks consumer policy, readable prose and safe input boundaries while excluding SVG', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('writing');
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
 const first = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert.equal(first.files, 2);
 assert(first.findings.filter(hit => hit.rule === 'bannedTerm').length >= 4);
 assert.equal(first.findings.filter(hit => hit.rule === 'sentenceLength').length, 1);
 assert.equal(first.findings.filter(hit => hit.rule === 'paragraphLength').length, 1);
 assert(first.findings.some(hit => hit.file === 'guide/page.md' && hit.line === 22));
 assert(!first.findings.some(hit => hit.rule === 'unusedConcept' || hit.rule === 'svgTerm' || hit.rule === 'svgStyle'));
 writeFileSync(join(root, 'guide/page.md'), '新词 good 旧词典.\n');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><style>.label { fill: black; }</style><text class="label">新<tspan>词</tspan></text></svg>');
 assert.equal(call(root, ['docs', 'check'], reportSchema).ok, true);
 mkdirSync(join(root, 'guide/exempt-more'));
 writeFileSync(join(root, 'guide/exempt-more/page.md'), 'bad');
 assert(call(root, ['docs', 'check'], reportSchema, '', 1).findings.some(hit => hit.file === 'guide/exempt-more/page.md'));
 rmSync(join(root, 'guide/exempt-more'), { recursive: true });
 writeFileSync(join(root, 'guide/page.md'), 'clear');
 writeFileSync(join(root, 'guide/figure.svg'), '<svg><text class="label">幽灵</text></svg>');
 const missing = call(root, ['docs', 'check'], reportSchema, '', 1);
 assert(missing.findings.some(hit => hit.rule === 'unusedConcept'));
 assert(!missing.findings.some(hit => hit.file.endsWith('.svg')));
 writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy({ ...policy, roots: ['missing'] }));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'WritingInputNotFound');
 writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'UnsafePath');
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed scoped Markdown owners are discovered after direct editing', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('scoped-owner-cli');
 const ownerPath = 'docs/feature/sample/writing.md';
 const catalogPath = 'docs/feature/sample/concepts.md';
 assert.equal(call(root, ['writing', 'show', '--path', ownerPath], Schema.Struct({ state: Schema.String })).state, 'missing');
 write(root, ownerPath, renderWritingPolicy({ bannedTerms: [] }));
 write(root, catalogPath, '# Terms\n\n## Feedback {#feedback}\n\nA response\n');
 write(root, 'docs/feature/sample/page.md', 'Feedback.\n');
 assert.equal(call(root, ['concepts', 'show', '--path', catalogPath], Schema.Struct({ state: Schema.String })).state, 'valid');
 assert(call(root, ['writing', 'index'], Schema.Struct({ scopes: Schema.Array(Schema.Struct({ scope: Schema.String })) })).scopes.some(item => item.scope === 'docs/feature/sample'));
 assert(call(root, ['concepts', 'index'], Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String })) })).concepts.some(item => item.reference === catalogPath + '#feedback'));
 assert.equal(call(root, ['writing', 'check', '--path', ownerPath], CheckOutput).ok, true);
})));
