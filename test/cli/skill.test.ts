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

// @use-case docs/feature/local-sdlc/use-case/validate-change-with-project-tools.md
test('packed CLI exposes the skill entrypoint and selected topics outside a consumer', () => Effect.runPromise(Effect.promise(async () => {
  const outside = join(scratch, 'outside');
  mkdirSync(outside);
  const examplePath = 'docs/guides/spec-examples.md';
  const modelPath = 'docs/document-model.md';
  mkdirSync(join(outside, 'docs/guides'), { recursive: true });
  writeFileSync(join(outside, examplePath), '# Consumer content must not replace packaged examples\n');
  writeFileSync(join(outside, modelPath), '# Consumer model must not replace the installed model\n');
  const help = await runCli({ argv: ['--help'], cwd: outside, env: process.env });
  assert.equal(help.exitCode, 0, help.stderr);
  assert.match(help.stdout, /concord --skill \[topic\]/);
  const main = await runCli({ argv: ['--skill'], cwd: outside, env: process.env });
  assert.equal(main.exitCode, 0, main.stderr);
  assert.match(main.stdout, /^---\nname: concord\n/);
  assert.match(main.stdout, /concord --skill test/);
  assert.doesNotMatch(main.stdout, /# 测试标记与原生收集/);

  const topic = await runCli({ argv: ['--skill', 'test'], cwd: outside, env: process.env });
  assert.equal(topic.exitCode, 0, topic.stderr);
  assert.match(topic.stdout, /# 测试标记与原生收集/);
  assert.match(topic.stdout, /concord test show/);
  assert.match(topic.stdout, /直接选择并运行测试/u);
  assert.match(topic.stdout, /报告实际命令、范围、结果和未验证项/u);
  assert.match(topic.stdout, /Concord 不提供测试执行、红绿核验或结果裁决/u);
  assert.doesNotMatch(topic.stdout, /concord (?:test (?:run|verify)|fix verify)/u);

  const feedback = await runCli({ argv: ['--skill', 'feedback'], cwd: outside, env: process.env });
  assert.equal(feedback.exitCode, 0, feedback.stderr);
  assert.match(feedback.stdout, /concord feedback import/);
  assert.match(feedback.stdout, /concord issue close <id> --reason <text>/u);
  assert.match(feedback.stdout, /不执行测试/u);

  const all = await runCli({ argv: ['--skill', 'all'], cwd: outside, env: process.env });
  assert.equal(all.exitCode, 0, all.stderr);
  assert.match(all.stdout, /# 初始化与模板/);
  assert.match(all.stdout, /# Issue 与多来源反馈/);
  for (const guide of ['start', 'docs-from-scratch', 'docs-from-code', 'document', 'spec', 'implement', 'review', 'fix']) {
    assert.ok(main.stdout.includes(`concord --skill ${guide}`));
    const reply = await runCli({ argv: ['--skill', guide], cwd: outside, env: process.env });
    assert.equal(reply.exitCode, 0, reply.stderr);
    const source = readFileSync(join(sourceRoot, `skills/concord/references/${guide}.md`), 'utf8');
    const expected = guide === 'document'
      ? [source, readFileSync(join(sourceRoot, modelPath), 'utf8'), readFileSync(join(sourceRoot, examplePath), 'utf8')].map(section => section.trimEnd()).join('\n\n---\n\n')
      : source.trimEnd();
    assert.equal(reply.stdout.trimEnd(), expected);
    assert.ok(all.stdout.includes(expected));
    if (guide === 'fix') {
      assert.match(reply.stdout, /直接使用项目测试工具确认复现/u);
      assert.match(reply.stdout, /报告实际命令、结果与未验证项/u);
      assert.match(reply.stdout, /concord issue close <id> --reason <text>/u);
      assert.match(reply.stdout, /关闭后再运行 `concord check`/u);
      assert.doesNotMatch(reply.stdout, /concord (?:test (?:run|verify)|fix verify)/u);
    }
  }
  const examples = readFileSync(join(sourceRoot, examplePath), 'utf8').trimEnd();
  assert.equal(all.stdout.split(examples).length, 2, 'all includes the docs examples exactly once');
  const model = readFileSync(join(sourceRoot, modelPath), 'utf8').trimEnd();
  assert.equal(all.stdout.split(model).length, 2, 'all includes the document model exactly once');
  assert.equal(readFileSync(join(outside, examplePath), 'utf8'), '# Consumer content must not replace packaged examples\n');
  assert.equal(readFileSync(join(outside, modelPath), 'utf8'), '# Consumer model must not replace the installed model\n');
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
