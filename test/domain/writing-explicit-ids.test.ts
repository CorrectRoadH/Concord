import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { renderWritingPolicy } from '../../src/model/index.ts';
import { checkWriting } from '../../src/domain/writing/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/feature/documentation-quality/format.md#匹配
test('explicit heading and step IDs are excluded while authored terminology remains checked', async () => {
  const root = (await createConsumer());
  const path = 'docs/feature/sample/use-case/checkout.md';
  const write = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  try {
    write('docs/writing.md', renderWritingPolicy({ roots: ['docs/feature/sample'], bannedTerms: [] }));
    write('docs/feature/sample/concepts.md', '# 术语\n\n## 远端写入计划 {#plan}\n\n写入前的授权计划。\n\n旧写法：`receipt`\n\n## 前像 {#preimage}\n\n读取时的内容。\n\n旧写法：`preimage`\n\n## Ghost {#ghost}\n\nOnly an ID mentions this term.\n');
    write(path, [
      '# 结算 {#receipt}',
      '',
      '## 远端写入计划 {#issue-receipt}',
      '',
      '## 前像 {#preimage} ##',
      '',
      '## **前像** {#Ghost}',
      '',
      '前像 {#receipt}',
      '----------------',
      '',
      '1. 检查远端写入计划。 {#receipt}',
      '',
      '## receipt {#visible}',
      '',
      'receipt and preimage.',
      '',
      'Ordinary braces {#receipt} remain prose.',
      '',
      '`receipt` [前像](#preimage) <!-- receipt -->',
      '',
      '## Escaped \\{#receipt}',
      '',
      '## [Label {#receipt}](#preimage)',
      '',
    ].join('\n'));
    const repo = (await LocalRepository.open(root, { persistentCache: 'off' }));
    try {
      const report = checkWriting(repo, undefined, false);
      assert.deepEqual(report.findings.filter(item => item.rule === 'bannedTerm').map(item => ({ file: item.file, line: item.line, term: item.message.split(':')[0] })), [
        { file: path, line: 14, term: 'receipt' },
        { file: path, line: 16, term: 'receipt' },
        { file: path, line: 16, term: 'preimage' },
        { file: path, line: 18, term: 'receipt' },
        { file: path, line: 22, term: 'receipt' },
        { file: path, line: 24, term: 'receipt' },
      ]);
      assert.deepEqual(report.findings.filter(item => item.rule === 'unusedConcept').map(item => item.source?.ref), ['docs/feature/sample/concepts.md#ghost']);
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
