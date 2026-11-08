import { runCli } from '../support/cli.ts';
import { sourceRoot } from '../support/source-consumer.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { Effect, Schema } from 'effect';

const ErrorOutput = Schema.Struct({ error: Schema.String });

const scratch = mkdtempSync(join(tmpdir(), 'concord-skill-'));

before(() => Effect.runPromise(Effect.sync(() => {
  const owner = sourceRoot;
  for (const path of ['skills/concord/SKILL.md', 'skills/concord/references/test.md', 'skills/concord/references/feedback.md', 'skills/concord/references/start.md', 'skills/concord/references/docs-from-scratch.md', 'skills/concord/references/docs-from-code.md', 'skills/concord/references/spec.md', 'skills/concord/references/implement.md', 'skills/concord/references/review.md', 'skills/concord/references/fix.md']) {
    assert.ok(existsSync(join(owner, path)), `source skill is missing ${path}`);
  }
})));

after(() => Effect.runPromise(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));

// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
test('packed CLI exposes the skill entrypoint and selected topics outside a consumer', () => Effect.runPromise(Effect.promise(async () => {
  const outside = join(scratch, 'outside');
  mkdirSync(outside);
  const help = await runCli({ argv: ['--help'], cwd: outside, env: process.env });
  assert.equal(help.exitCode, 0, help.stderr);
  assert.match(help.stdout, /concord --skill \[topic\]/);
  const main = await runCli({ argv: ['--skill'], cwd: outside, env: process.env });
  assert.equal(main.exitCode, 0, main.stderr);
  assert.match(main.stdout, /^---\nname: concord\n/);
  assert.match(main.stdout, /concord --skill test/);
  assert.doesNotMatch(main.stdout, /# 测试标记与执行/);

  const topic = await runCli({ argv: ['--skill', 'test'], cwd: outside, env: process.env });
  assert.equal(topic.exitCode, 0, topic.stderr);
  assert.match(topic.stdout, /# 测试标记与执行/);
  assert.match(topic.stdout, /concord test show/);

  const feedback = await runCli({ argv: ['--skill', 'feedback'], cwd: outside, env: process.env });
  assert.equal(feedback.exitCode, 0, feedback.stderr);
  assert.match(feedback.stdout, /concord feedback import/);

  const all = await runCli({ argv: ['--skill', 'all'], cwd: outside, env: process.env });
  assert.equal(all.exitCode, 0, all.stderr);
  assert.match(all.stdout, /# 初始化与模板/);
  assert.match(all.stdout, /# Issue 与多来源反馈/);
  for (const guide of ['start', 'docs-from-scratch', 'docs-from-code', 'spec', 'implement', 'review', 'fix']) {
    assert.ok(main.stdout.includes(`concord --skill ${guide}`));
    const reply = await runCli({ argv: ['--skill', guide], cwd: outside, env: process.env });
    assert.equal(reply.exitCode, 0, reply.stderr);
    const source = readFileSync(join(sourceRoot, `skills/concord/references/${guide}.md`), 'utf8');
    assert.equal(reply.stdout.trimEnd(), source.trimEnd());
    assert.ok(all.stdout.includes(source.trimEnd()));
  }
  assert.equal(existsSync(join(outside, 'concord.config.ts')), false);
})));

// @use-case docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
test('skill routing rejects unknown and mixed mutation argv without loading the host or writing', () => Effect.runPromise(Effect.promise(async () => {
  const hostile = join(scratch, 'hostile');
  mkdirSync(hostile);
  writeFileSync(join(hostile, 'concord.repository.json'), JSON.stringify({ format: 'concord.repository/v1', host: 'host.mjs' }));
  writeFileSync(join(hostile, 'host.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('host-loaded', 'yes'); throw new Error('host loaded');\n");

  const unknown = await runCli({ argv: ['--skill', 'unknown'], cwd: hostile, env: process.env });
  assert.equal(unknown.exitCode, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(unknown.stderr).error, 'SkillTopicUnknown');

  const mixed = await runCli({ argv: ['--skill', 'init', '--dry-run'], cwd: hostile, env: process.env });
  assert.equal(mixed.exitCode, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(mixed.stderr).error, 'SkillArgumentsInvalid');
  assert.match(mixed.stderr, /docs-from-scratch\|docs-from-code/u);
  assert.equal(existsSync(join(hostile, 'host-loaded')), false);
  assert.equal(existsSync(join(hostile, 'concord.config.ts')), false, 'fixture marker should remain the only repository-like input');
  assert.equal(readFileSync(join(hostile, 'concord.repository.json'), 'utf8'), JSON.stringify({ format: 'concord.repository/v1', host: 'host.mjs' }));
})));
