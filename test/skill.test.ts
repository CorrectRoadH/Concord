import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { Effect, Schema } from 'effect';

const PackageOutput = Schema.Array(Schema.Struct({
  filename: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
}));
const ErrorOutput = Schema.Struct({ error: Schema.String });

const scratch = mkdtempSync(join(tmpdir(), 'concord-skill-'));
let cli: string;

before(() => Effect.runPromise(Effect.sync(() => {
  const packed = Schema.decodeUnknownSync(Schema.fromJsonString(PackageOutput))(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 }),
  );
  const artifact = packed[0];
  assert.ok(artifact);
  for (const path of ['skills/concord/SKILL.md', 'skills/concord/references/test.md', 'skills/concord/references/feedback.md', 'dist/skill.js']) {
    assert.ok(artifact.files.some(file => file.path === path), `packed skill is missing ${path}`);
  }
  const install = join(scratch, 'tool');
  mkdirSync(install);
  writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, artifact.filename)], { cwd: install, encoding: 'utf8', timeout: 60_000 });
  cli = join(install, 'node_modules/concord-sdlc/dist/entry.js');
})));

after(() => Effect.runPromise(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed CLI exposes the skill entrypoint and selected topics outside a consumer', () => Effect.runPromise(Effect.sync(() => {
  const outside = join(scratch, 'outside');
  mkdirSync(outside);
  const help = spawnSync(process.execPath, [cli, '--help'], { cwd: outside, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /concord --skill \[topic\]/);
  const main = spawnSync(process.execPath, [cli, '--skill'], { cwd: outside, encoding: 'utf8' });
  assert.equal(main.status, 0, main.stderr);
  assert.match(main.stdout, /^---\nname: concord\n/);
  assert.match(main.stdout, /concord --skill test/);
  assert.doesNotMatch(main.stdout, /# 测试注释与命令证据/);

  const topic = spawnSync(process.execPath, [cli, '--skill', 'test'], { cwd: outside, encoding: 'utf8' });
  assert.equal(topic.status, 0, topic.stderr);
  assert.match(topic.stdout, /# 测试注释与命令证据/);
  assert.match(topic.stdout, /concord test show/);

  const feedback = spawnSync(process.execPath, [cli, '--skill', 'feedback'], { cwd: outside, encoding: 'utf8' });
  assert.equal(feedback.status, 0, feedback.stderr);
  assert.match(feedback.stdout, /concord feedback import/);

  const all = spawnSync(process.execPath, [cli, '--skill', 'all'], { cwd: outside, encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /# 初始化与模板/);
  assert.match(all.stdout, /# Repository profile 边界/);
  assert.equal(existsSync(join(outside, 'concord.config.ts')), false);

  const installedMain = join(cli, '../../skills/concord/SKILL.md');
  const original = readFileSync(installedMain, 'utf8');
  try {
    rmSync(installedMain);
    const unreadable = spawnSync(process.execPath, [cli, '--skill'], { cwd: outside, encoding: 'utf8' });
    assert.equal(unreadable.status, 1);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(unreadable.stderr).error, 'SkillContentUnreadable');
    writeFileSync(installedMain, '');
    const invalid = spawnSync(process.execPath, [cli, '--skill'], { cwd: outside, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(invalid.stderr).error, 'SkillContentInvalid');
  } finally {
    writeFileSync(installedMain, original);
  }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('skill routing rejects unknown and mixed mutation argv without loading the host or writing', () => Effect.runPromise(Effect.sync(() => {
  const hostile = join(scratch, 'hostile');
  mkdirSync(hostile);
  writeFileSync(join(hostile, 'concord.repository.json'), JSON.stringify({ format: 'concord.repository/v1', host: 'host.mjs' }));
  writeFileSync(join(hostile, 'host.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('host-loaded', 'yes'); throw new Error('host loaded');\n");

  const unknown = spawnSync(process.execPath, [cli, '--skill', 'unknown'], { cwd: hostile, encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(unknown.stderr).error, 'SkillTopicUnknown');

  const mixed = spawnSync(process.execPath, [cli, '--skill', 'init', '--dry-run'], { cwd: hostile, encoding: 'utf8' });
  assert.equal(mixed.status, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(mixed.stderr).error, 'SkillArgumentsInvalid');
  assert.equal(existsSync(join(hostile, 'host-loaded')), false);
  assert.equal(existsSync(join(hostile, 'concord.config.ts')), false, 'fixture marker should remain the only repository-like input');
  assert.equal(readFileSync(join(hostile, 'concord.repository.json'), 'utf8'), JSON.stringify({ format: 'concord.repository/v1', host: 'host.mjs' }));
})));
