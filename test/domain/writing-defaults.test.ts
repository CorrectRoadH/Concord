import { initialize } from '../support/operations.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.js";

import { checkWriting } from "../../src/domain/writing/index.js";
import { showWriting } from "../../src/domain/writing/index.js";
import { renderTypeScriptConfig } from "../../src/base/workspace/index.js";
import { digest } from "../../src/model/index.js";
import { defaultWritingSource } from "../../src/model/index.js";

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('init adopts a complete writing preset, checks it immediately, and preserves existing policy bytes', () => Effect.runPromise(Effect.sync(() => {
  for (const existing of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'concord-writing-preset-'));
    const custom = '# Custom rules\n\n句子不超过 75 个字符。\n';
    try {
      execFileSync('git', ['init', '-q', root]);
      if (existing) {
        mkdirSync(join(root, 'docs'));
        writeFileSync(join(root, 'docs/writing.md'), custom);
      }
      const initial = new LocalRepository(root, { initialize: true });
      try {
        const preview = initialize(initial, true, { testRoots: [] });
        assert.equal(preview.createdPaths.includes('docs/writing.md'), !existing);
        initialize(initial, false, { testRoots: [] });
      } finally { initial.close(); }
      if (!existing) {
        const fresh = new LocalRepository(root);
        try { assert.deepEqual(checkWriting(fresh).findings, []); } finally { fresh.close(); }
      }
      if (existing) {
        assert.equal(readFileSync(join(root, 'docs/writing.md'), 'utf8'), custom);
      } else {
        writeFileSync(join(root, 'docs/sample.md'), '# 示例\n\n通过兜底处理。\n\n' + '长'.repeat(141) + '。\n');
        const repo = new LocalRepository(root);
        try {
          const shown = showWriting(repo);
          assert.equal(shown.state, 'valid');
          assert.equal(shown.policy?.sentenceLength, 140);
          assert.equal(shown.policy?.paragraphLength, 320);
          assert.equal(Object.hasOwn(shown.policy!, 'svgTerms'), false);
          assert.equal(Object.hasOwn(shown.policy!, 'svgStyle'), false);
          assert.equal('unusedConcepts' in shown.policy!, false);
          const report = checkWriting(repo);
          assert.ok(report.findings.some(finding => finding.file === 'docs/sample.md' && finding.rule === 'sentenceLength'));
          assert.ok(report.findings.some(finding => finding.file === 'docs/sample.md' && finding.context.includes('兜底')));
        } finally { repo.close(); }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('init publication and recovery reject custom or local policies masquerading as the preset', () => Effect.runPromise(Effect.sync(() => {
  for (const [path, after] of [
    ['docs/writing.md', '# Custom rules\n'],
    ['docs/feature/demo/writing.md', defaultWritingSource],
    ['docs/writing.md', defaultWritingSource + '\n## Unknown section\n'],
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), 'concord-writing-init-guard-'));
    try {
      execFileSync('git', ['init', '-q', root]);
      const repo = new LocalRepository(root, { initialize: true, dryRun: true });
      const preview = initialize(repo, true, { testRoots: [] });
      const configSource = renderTypeScriptConfig(preview.config);
      const changes = [
        { path: 'concord.config.ts', before: null, after: configSource, beforeDigest: null, afterDigest: digest(configSource), mode: 0o644 },
        { path, before: null, after, beforeDigest: null, afterDigest: digest(after), mode: 0o644 },
      ];
      try { assert.throws(() => repo.publish('init', changes), { code: 'InvalidChange' }); }
      finally { repo.close(); }
      const privateDir = join(root, '.git/concord');
      mkdirSync(privateDir, { recursive: true });
      const journalPath = join(privateDir, 'journal.json');
      for (const phase of ['prepared', 'committed']) {
      writeFileSync(journalPath, JSON.stringify({ format: 'concord.journal', root, privateDir, operation: 'init', phase, directories: ['docs'], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') }, changes }));
      assert.throws(() => new LocalRepository(root, { recover: true }), { code: 'RecoveryConflict' });
      assert.equal(existsSync(journalPath), true);
      assert.equal(existsSync(join(root, path)), false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
})));
