import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository } from '../support/repository.ts';
import { initialize } from '../support/operations.ts';
import { parseWritingPolicy, renderWritingPolicy } from '../../src/model/index.ts';
import { checkWriting } from '../../src/domain/writing/index.ts';
import { readConceptCatalog } from '../../src/domain/concepts/index.ts';

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('Markdown rules round-trip escaped cells, limits, roots and longer exceptions and reject malformed sections', () => {
  const policy = { roots: ['docs', 'README.md'] as const, sentenceLength: 20, paragraphLength: 60, bannedTerms: [{ term: 'bad', use: '`clear` | exact', why: String.raw`Use <specific> *words* \ | paths`, roots: ['docs/cart'], allowIn: ['badger'] }] };
  assert.deepEqual(parseWritingPolicy(renderWritingPolicy(policy)), policy);
  assert.deepEqual(parseWritingPolicy('# Rules\n\n## 不用的词\n\n词 | 改成 | 为什么 | 只在 | 例外\n--- | --- | --- | --- | ---\nbad | good | clear | |\n').bannedTerms, [{ term: 'bad', use: 'good', why: 'clear' }]);
  assert.deepEqual(parseWritingPolicy('# Rules\n\nSome introduction.\n'), { bannedTerms: [] });
  for (const source of [
    '---\nroots: [docs]\n---\n# Rules\n', '# Rules\n\n句子不超过 0 个字符。\n',
    '# Rules\n\n句子不超过 many 个字符。\n', '# Rules\n\n## Unknown\n',
    '# Rules\n\n## 不用的词\n\n| 词 | 改成 | 为什么 |\n| --- | --- | --- |\n',
    renderWritingPolicy({ bannedTerms: [{ term: 'bad', use: 'good', why: 'clear', allowIn: ['bad'] }] }),
    renderWritingPolicy({ bannedTerms: [{ term: 'bad', use: 'good', why: 'clear' }, { term: 'BAD', use: 'good', why: 'duplicate' }] }),
    renderWritingPolicy({ roots: ['../escape'], bannedTerms: [] }),
  ]) assert.throws(() => parseWritingPolicy(source), /line \d+:/u);
  assert.throws(() => parseWritingPolicy(renderWritingPolicy(policy), 'docs/cart/writing.md'), /Only docs\/writing.md/u);
  const catalog = readConceptCatalog('# Terms\n\nIntro.\n\n## Order {#order}\n\nA purchase.\n\n旧写法：`单子`、`订货单`\n\n### Details\n\nExplanation.\n');
  assert.deepEqual(catalog.concepts[0]?.deprecated, ['单子', '订货单']);
  for (const old of ['旧写法：unquoted', '旧写法：`Old` and `Older`', '旧写法：`Order`', '旧写法：`Old`、`old`']) assert.throws(() => readConceptCatalog(`# Terms\n\n## Order {#order}\n\nA purchase.\n\n${old}\n`), { code: 'InvalidConceptCatalog' });
});

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('scopes inherit declared lengths, accumulate bans and exclude rule files from prose and concept usage', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-markdown-'));
  const write = (path: string, source: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
  const check = () => { const repo = new LocalRepository(root, { persistentCache: 'off' }); try { return checkWriting(repo); } finally { repo.close(); } };
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true }); try { initialize(initial, false, { testRoots: [] }); } finally { initial.close(); }
    write('docs/writing.md', renderWritingPolicy({ roots: ['docs/page.md', 'docs/cart'], sentenceLength: 8, paragraphLength: 12, bannedTerms: [{ term: 'bad', use: 'good', why: 'global', allowIn: ['badger'] }] }));
    write('docs/cart/writing.md', renderWritingPolicy({ bannedTerms: [{ term: 'old', use: 'new', why: 'RuleOnly forbidden bad', roots: ['docs/cart/deep'] }] }));
    write('docs/cart/deep/writing.md', renderWritingPolicy({ sentenceLength: 30, bannedTerms: [] }));
    write('docs/cart/concepts.md', '# Terms\n\n## RuleOnly {#rule-only}\n\nA concept.\n');
    write('docs/page.md', 'badger.\n');
    write('docs/cart/page.md', 'bad old.\n\nabcdefghij.\n');
    write('docs/cart/deep/page.md', 'bad old.\n\nabcdefghijklmn.\n');
    const report = check();
    assert(!report.findings.some(item => item.file.endsWith('/writing.md')));
    assert(!report.findings.some(item => item.file === 'docs/page.md'));
    assert(report.findings.some(item => item.rule === 'unusedConcept' && item.file === 'docs/cart/concepts.md'));
    const local = report.findings.filter(item => item.file === 'docs/cart/page.md');
    assert.equal(local.filter(item => item.rule === 'bannedTerm').length, 1);
    assert(local.some(item => item.rule === 'sentenceLength' && item.source?.path === 'docs/writing.md'));
    const deep = report.findings.filter(item => item.file === 'docs/cart/deep/page.md');
    assert.equal(deep.filter(item => item.rule === 'bannedTerm').length, 2);
    assert(!deep.some(item => item.rule === 'sentenceLength'));
    assert(deep.some(item => item.rule === 'paragraphLength' && item.source?.path === 'docs/writing.md'));
    write('docs/writing.md', renderWritingPolicy({ roots: ['docs/page.md'], bannedTerms: [] }));
    write('docs/page.md', 'a'.repeat(600) + '\n');
    assert.deepEqual(check().findings, [], 'no declared limits means no length checks');
    write('docs/writing.md', renderWritingPolicy({ roots: ['docs/page.md'], sentenceLength: 3, paragraphLength: 3, bannedTerms: [{ term: 'bad', use: 'good', why: 'clear' }] }));
    write('docs/page.md', '# A very long heading\n\n| Heading |\n| --- |\n| a very long table cell |\n\nColumn | Another\n--- | ---\na very long cell | ok\n\n`bad bad bad`\n\n<!-- bad -->\n\n```\nbad\n```\n\n[ok](bad)\n');
    assert.deepEqual(check().findings, [], 'code, comments and destinations are ignored; headings and tables have no length check');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
