import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { checkWriting } from '../dist/writing.js';
import { readWritingPolicy } from '../dist/writing-policy.js';
import { composeControlled } from '../dist/writing-controlled-policy.js';
import { decodeViewAction } from '../dist/application.js';
import { migrateWriting, setWriting, showWriting } from '../dist/writing-management.js';
import type { WritingPolicy } from '../dist/writing-schema.js';

const base = (controlled: unknown = undefined, extra = {}) => ({ format: 'concord.writing/v3', bannedTerms: [], roots: ['docs/corpus.md'], ...(controlled === undefined ? {} : { controlled }), ...extra });
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function fixture(run: (scan: (source: string, controlled?: unknown, extension?: string) => ReturnType<typeof checkWriting>, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'concord-controlled-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    const scan = (source: string, controlled?: unknown, extension = 'md') => {
      writeFileSync(join(root, 'docs/concord-writing.json'), encode(base(controlled, { roots: [`docs/corpus.${extension}`] })));
      writeFileSync(join(root, `docs/corpus.${extension}`), source);
      return checkWriting(repo);
    };
    run(scan, root);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}
const controlledTest = (name: string, run: Parameters<typeof fixture>[0]) => test(name, () => Effect.runPromise(Effect.sync(() => fixture(run))));

// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C1 C2 C12: nearest ordered list, quotes and separate paragraphs select independent limits', scan => {
  const words = `${Array(22).fill('read').join(' ')}.`;
  const policy = { language: 'en', sentence: { en: { procedural: 20, descriptive: 25 } } };
  const report = scan(`1. ${words}\n\n   ${words}\n\n   - ${words}\n\n     1. ${words}\n\n${words}\n\n- ${words}\n\n> 1. ${words}\n`, policy);
  assert.deepEqual(report.findings.map(f => [f.rule, f.actual, f.limit]), Array.from({ length: 3 }, () => ['proceduralSentenceLength', 22, 20]));
  assert(report.findings.every(f => f.source?.pointer === '/controlled/sentence/en/procedural'));
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C3 C4 C5: code counts once and action words describe repeated surface observations', scan => {
  const p = { language: 'zh', sentence: { zh: { procedural: 30 } }, procedural: { singleInstruction: true, requireVerb: true, verbs: { zh: ['删除', '返回'] } } };
  const report = scan('1. ' + '字'.repeat(30) + ' `删除。` `返回。` `x y`。\n\n2. 删除标记后返回列表。\n', p);
  assert.equal(report.findings.find(f => f.rule === 'proceduralSentenceLength')?.actual, 33);
  assert.equal(report.findings.find(f => f.rule === 'unapprovedProceduralVerb')?.message, '未命中项目受控动作词');
  const multiple = report.findings.find(f => f.rule === 'multipleInstructions')!;
  assert.equal(multiple.message, '命中多个受控动作词'); assert.equal(multiple.actual, 2);
  assert.deepEqual(multiple.matches?.map(m => m.text), ['删除', '返回']);
  assert.deepEqual(multiple.matches?.[0]?.start, { line: 3, column: 3 });
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C6 C7 C8: passive candidates, literal exceptions and paragraph sentences', scan => {
  const p = { language: 'auto', paragraphSentences: 6, passiveVoice: { zh: true, en: true, participles: ['cleared'], allowIn: { zh: ['被动'] } } };
  const report = scan('The cache is cleared by recover. It is ready. It is quickly cleared. A. B. C. D.\n\n被动模式。\n', p);
  assert.deepEqual(report.findings.map(f => f.rule).sort(), ['paragraphSentences', 'passiveVoice']);
  assert.equal(report.findings.find(f => f.rule === 'paragraphSentences')?.actual, 7);
  assert.equal(report.findings.find(f => f.rule === 'passiveVoice')?.message, '命中被动形式候选');
  assert.equal(scan('被动模式。', { language: 'zh', passiveVoice: { zh: true, allowIn: { zh: [] } } }).findings[0]?.matches?.[0]?.text, '被');
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C13: controlled paragraphs exclude GFM tables, MDX expressions and authored non-prose', scan => {
  const report = scan('---\ntitle: hidden\n---\n\n# Hidden title\n\nRead [this](https://hidden.invalid) ![hidden](image.png) `opaque words!`.\n\n| Hidden | Table |\n| --- | --- |\n| Words | Here |\n\n```text\nHidden words.\n```\n\n<!-- GENERATED:BEGIN -->\nHidden words.\n<!-- GENERATED:END -->\n\nimport X from "hidden"\n<Component attr="hidden" />\n\nVisible {hidden + **value**} prose.\n', { language: 'en', sentence: { en: { descriptive: 1 } } }, 'mdx');
  assert.deepEqual(report.findings.map(f => [f.actual, f.line]), [[3, 7], [2, 24]]);
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C14 C15 C16: fixed token and sentence rules, zero-letter and mixed-language selection', scan => {
  const p = { language: 'auto', sentence: { en: { descriptive: 1 }, zh: { descriptive: 1 } }, paragraphSentences: 1 };
  for (const [text, count] of [['3.14', 1], ['U.S.', 2], ["don't", 1], ['state-of-the-art', 1], ['v3', 2], ['café', 1], ['ка字a', 3]] as const) {
    const findings = scan(text, p).findings;
    assert.deepEqual(findings.map(f => f.actual), count > 1 ? [count] : [], text);
  }
  assert.equal(scan('3.14. `a! b.`', p).findings.find(f => f.rule === 'paragraphSentences')?.actual, 2);
  assert.deepEqual(scan('! ? … ; :', p).findings, []);
  assert.equal(scan('字a.', p).findings[0]?.language, 'zh');
  assert.equal(scan('字 cache service.', p).findings[0]?.language, 'en');
  assert.equal(scan('字 cache service.', { ...p, language: 'zh' }).findings[0]?.language, 'zh');
  assert.equal(scan('Dr. Smith uses e.g. a U.S. cache at 3.14.', { paragraphSentences: 1 }).findings.length, 0);
  assert.equal(scan('One... "Two!" Three?!', { paragraphSentences: 1 }).findings[0]?.actual, 3);
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C19 C20 C21: opt-in vocabularies, explicit forms, NFC ranges and local exemptions', scan => {
  assert.equal(scan('Execute execute.', { approvedWords: { enabled: true, en: [] } }).findings.length, 2);
  assert.equal(scan('Execute execute.', { approvedWords: { enabled: false, en: [] } }).findings.length, 0);
  const verbs = { en: [{ lemma: 'write', forms: ['writes', 'writing', 'wrote', 'written'] }, { lemma: 'read' }] };
  const p = { language: 'en', procedural: { singleInstruction: true, requireVerb: true, verbs } };
  assert.equal(scan('1. Writing write.\n\n2. writer.\n\n3. read the read result.', p).findings.filter(f => f.rule === 'multipleInstructions').length, 2);
  assert.equal(scan('1. writer.', p).findings[0]?.rule, 'unapprovedProceduralVerb');
  assert.equal(scan('1. read the read result.', { ...p, procedural: { ...p.procedural, allowIn: { en: ['the read result'] } } }).findings.length, 0);
  assert.equal(scan('1. 返回包含删除记录的列表。', { language: 'zh', procedural: { singleInstruction: true, verbs: { zh: ['返回', '删除'] } } }).findings[0]?.actual, 2);
  assert.equal(scan('1. 写入失败时拒绝请求。', { language: 'zh', procedural: { singleInstruction: true, verbs: { zh: ['写入', '拒绝'] } } }).findings[0]?.actual, 2);
  const normalized = scan("Cafe\u0301 DON’T.", { approvedWords: { enabled: true, en: [] } });
  assert.deepEqual(normalized.findings.map(f => f.matches?.[0]?.text), ['Cafe\u0301', "DON’T"]);
  assert.deepEqual(normalized.findings[0]?.matches?.[0]?.end, { line: 1, column: 5 });
  const mapped = scan('Good\nCaf&eacute;.', { approvedWords: { enabled: true, en: ['good'] } });
  assert.deepEqual(mapped.findings[0]?.matches?.[0]?.start, { line: 2, column: 0 });
  assert.deepEqual(mapped.findings[0]?.matches?.[0]?.end, { line: 2, column: 11 });
  assert.equal(mapped.findings[0]?.line, 2);
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C9 C17 C18: recursive leaf composition, clear barriers and missing vocabulary sources', (_scan, root) => {
  const ancestor = readWritingPolicy(encode(base({ language: 'en', sentence: { en: { procedural: 20, descriptive: 25 } }, procedural: { singleInstruction: true, verbs: { en: [{ lemma: 'read', forms: ['reading'] }] } } })));
  const child = (controlled: unknown) => readWritingPolicy(encode(base(controlled)));
  const owners = [{ path: 'docs/concord-writing.json', policy: ancestor }, { path: 'docs/sub/concord-writing.json', policy: child({ sentence: { en: { procedural: null } }, procedural: { verbs: { zh: ['读取'] } } }) }];
  const effective = composeControlled(owners);
  assert.equal(effective.get('sentence/en/procedural')?.value, null);
  assert.deepEqual(effective.get('sentence/en/descriptive'), { value: 25, source: { path: 'docs/concord-writing.json', pointer: '/controlled/sentence/en/descriptive' } });
  assert.throws(() => composeControlled([...owners, { path: 'docs/sub/clear/concord-writing.json', policy: child({ procedural: { verbs: { en: [] } } }) }]), (error: unknown) => {
    assert.match(String(error), /docs\/sub\/clear\/concord-writing.json/); assert.match(String(error), /singleInstruction/); return true;
  });
  const cleared = [...owners, { path: 'docs/sub/concord-writing.json', policy: child({ procedural: null }) }];
  assert.equal(composeControlled(cleared).get('procedural/verbs/en')?.value, null);
  assert.throws(() => composeControlled([...cleared, { path: 'docs/sub/deeper/concord-writing.json', policy: child({ procedural: { requireVerb: true } }) }]), { code: 'InvalidWritingPolicy' });
  mkdirSync(join(root, 'docs/sub'), { recursive: true });
  writeFileSync(join(root, 'docs/concord-writing.json'), encode({ ...ancestor, roots: ['docs/sub'] }));
  writeFileSync(join(root, 'docs/sub/concord-writing.json'), encode({ format: 'concord.writing/v3', bannedTerms: [], controlled: { sentence: { en: { procedural: null } } } }));
  writeFileSync(join(root, 'docs/sub/page.md'), `1. ${'reading '.repeat(21)}.\n\n${'reading '.repeat(26)}.`);
  const repo = new LocalRepository(root);
  try { const report = checkWriting(repo); assert.deepEqual(report.findings.map(f => f.rule).sort(), ['descriptiveSentenceLength', 'multipleInstructions']); }
  finally { repo.close(); }
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C10: migration preserves fields and legacy character observations without controlled defaults', (scan, root) => {
  scan('# Header\n\nAbc `inline content` [link](https://hidden) ![alt](url). Next Sentence!\n', undefined);
  const old = { format: 'concord.writing/v2', roots: ['docs/corpus.md'], bannedTerms: [], sentenceLength: 10, paragraphLength: 25, unusedConcepts: false };
  writeFileSync(join(root, 'docs/concord-writing.json'), encode(old));
  const repo = new LocalRepository(root);
  try {
    assert.throws(() => checkWriting(repo), { code: 'WritingMigrationRequired' });
    const shown = showWriting(repo); assert.equal(shown.state, 'invalid'); assert.equal(shown.source, encode(old));
    const dry = migrateWriting(repo, 'docs/concord-writing.json', true);
    assert.equal(showWriting(repo).digest, shown.digest); assert.equal(dry.dryRun, true);
    const result = migrateWriting(repo, 'docs/concord-writing.json');
    assert.deepEqual(result.policy, { ...old, format: 'concord.writing/v3' });
    const findings = checkWriting(repo).findings;
    assert.deepEqual(findings.map(f => [f.rule, f.line, f.message, f.context]), [
      ['paragraphLength', 3, 'Paragraph has 34 characters; maximum 25', 'Abc inline content link . Next Sentence!'],
      ['sentenceLength', 3, 'Sentence has 21 characters; maximum 10', 'Abc inline content link .'],
      ['sentenceLength', 3, 'Sentence has 13 characters; maximum 10', 'Next Sentence!'],
    ]);
  } finally { repo.close(); }
});
// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
controlledTest('C24 C25: strict boundary diagnostics and bounded vocabulary, matches and reports', (scan, root) => {
  for (const controlled of [{ surprise: true }, { sentence: { en: { procedural: 0 } } }, { paragraphSentences: 1.5 }, { passiveVoice: { participles: ['two words'] } }, { procedural: { verbs: { en: [{ lemma: 'write', forms: ['wrote'] }, { lemma: 'wrote' }] } } }]) {
    const invalid = base(controlled);
    assert.throws(() => readWritingPolicy(encode(invalid)), { code: 'InvalidWritingPolicy' });
    assert.throws(() => decodeViewAction({ action: 'writing.set', policy: invalid, expectedDigest: null }), { code: 'InvalidWritingPolicy' });
    const repo = new LocalRepository(root);
    try { assert.throws(() => setWriting(repo, invalid as unknown as WritingPolicy, showWriting(repo).digest), { code: 'InvalidWritingPolicy' }); }
    finally { repo.close(); }
  }
  assert.throws(() => readWritingPolicy(encode(base({ approvedWords: { en: Array(4097).fill('read') } }))), { code: 'WritingBudgetExceeded' });
  assert.throws(() => readWritingPolicy(encode(base({ procedural: { allowIn: { zh: ['字'.repeat(129)] } } }))), { code: 'WritingBudgetExceeded' });
  assert.throws(() => scan('word '.repeat(10001), { approvedWords: { enabled: true, en: [] } }), (error: unknown) => { assert.equal((error as { code: string }).code, 'WritingBudgetExceeded'); assert.deepEqual((error as { details: unknown }).details, { complete: false }); return true; });
  assert.throws(() => scan('字'.repeat(2000), { language: 'zh', procedural: { allowIn: { zh: Array.from({ length: 100 }, (_, index) => '字'.repeat(index + 1)) } }, passiveVoice: { zh: true, allowIn: { zh: Array.from({ length: 100 }, (_, index) => '字'.repeat(index + 1)) } } }), { code: 'WritingBudgetExceeded' });
  const oversized = readWritingPolicy(encode(base({ approvedWords: { en: ['a'.repeat(1024 * 1024 + 1)] } })));
  assert.throws(() => composeControlled([{ path: 'docs/concord-writing.json', policy: oversized }]), { code: 'WritingBudgetExceeded' });
  assert.throws(() => scan('Text.', { language: 'auto', procedural: { requireVerb: true, verbs: { en: [{ lemma: 'read' }] } } }), { code: 'InvalidWritingPolicy' });
  assert.throws(() => scan('Text.', { passiveVoice: { en: true, participles: [] } }), { code: 'InvalidWritingPolicy' });
});
