// 跨进程保证：运行环境——删除或清空私有安装的 skill 内容时，真实私有 entry 保留具名错误与退出码且不破坏共享安装。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { privateSourceInstallation } from '../support/private-source.ts';
import { tmpdir } from '../support/temporary.ts';

const ErrorOutput = Schema.Struct({ error: Schema.String });

// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
test('private skill installation reports missing and empty installed content', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-skill-'));
  try {
    const owner = join(scratch, 'source');
    const cli = privateSourceInstallation(owner);
    for (const path of ['skills/concord/SKILL.md', 'skills/concord/references/test.md', 'skills/concord/references/feedback.md', 'skills/concord/references/docs-from-scratch.md', 'skills/concord/references/docs-from-code.md', 'skills/concord/references/spec.md', 'skills/concord/references/implement.md', 'skills/concord/references/review.md', 'skills/concord/references/fix.md']) {
      assert.ok(existsSync(join(owner, path)), `source skill is missing ${path}`);
    }
    const outside = join(scratch, 'outside'); mkdirSync(outside);
    for (const [path, args] of [
      ['skills/concord/SKILL.md', ['--skill']],
      ['docs/guides/spec-examples.md', ['--skill', 'document']],
    ] as const) {
      const installed = join(owner, path);
      const original = readFileSync(installed, 'utf8');
      try {
        rmSync(installed);
        const unreadable = spawnSync(process.execPath, [cli, ...args], { cwd: outside, encoding: 'utf8' });
        assert.equal(unreadable.status, 1);
        assert.equal(unreadable.stdout, '', 'missing examples must not produce a partial guide');
        assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(unreadable.stderr).error, 'SkillContentUnreadable');
        writeFileSync(installed, '');
        const invalid = spawnSync(process.execPath, [cli, ...args], { cwd: outside, encoding: 'utf8' });
        assert.equal(invalid.status, 1);
        assert.equal(invalid.stdout, '');
        assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(invalid.stderr).error, 'SkillContentInvalid');
      } finally { writeFileSync(installed, original); }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
