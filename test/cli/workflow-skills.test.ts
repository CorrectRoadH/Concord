import assert from 'node:assert/strict';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { Scope} from 'effect';
import { Effect, FileSystem, Schema } from 'effect';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { digest, SkillsInstallReceiptSchema, workflowSkillPaths } from '../../src/model/index.ts';
import { tmpdir } from '../support/temporary.ts';
import { runCli } from '../support/cli.ts';

type Requirements = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;
const runCase = (body: (root: string) => Effect.Effect<void, unknown, Requirements>) => Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-workflow-skills-' });
    yield* spawner.exitCode(ChildProcess.make('git', ['init', '-q', root]));
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer)),
);
const cli = Effect.fn('test.workflowSkills.cli')(function*(root: string, args: string[], status = 0, json = true) {
  const { stdout, stderr, exitCode: code } = yield* Effect.promise(() => runCli({
    argv: [...(args.includes('--skill') ? [] : ['--root', root]), ...(json ? ['--json'] : []), ...args],
    cwd: root, env: process.env,
  }));
  assert.equal(Number(code), status, JSON.stringify({ args, stdout, stderr, code }));
  return { stdout, stderr };
});
const receipt = (output: { stdout: string }) => Schema.decodeUnknownSync(Schema.fromJsonString(SkillsInstallReceiptSchema), { onExcessProperty: 'error' })(output.stdout);
const readError = (output: { stderr: string }) => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String, details: Schema.optional(Schema.Struct({ path: Schema.String })) })))(output.stderr);

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
test('workflow updates are advisory and install reports safe obsolete removals in JSON and human output', () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* cli(root, ['init']);
  const obsolete = '.agents/skills/concord-retired/SKILL.md';
  const untouched = '.claude/skills/concord-custom/SKILL.md';
  const source = yield* fs.readFileString(join(root, workflowSkillPaths[0]!));
  for (const [path, content] of [[obsolete, source], [untouched, 'User owned skill.\n']]) {
    yield* fs.makeDirectory(dirname(join(root, path!)), { recursive: true });
    yield* fs.writeFileString(join(root, path!), content!);
  }
  const changed = workflowSkillPaths[0]!;
  const old = source.replace(/<!-- concord-managed version=[^\s<>]+ -->/u, '<!-- concord-managed -->') + '\nOld description.\n';
  yield* fs.writeFileString(join(root, changed), old);
  const expected = [changed, '.claude/skills/concord-spec/SKILL.md', obsolete].sort();
  const Diagnostic = Schema.fromJsonString(Schema.Struct({
    ok: Schema.Boolean,
    advisories: Schema.Array(Schema.Struct({ code: Schema.String, details: Schema.optional(Schema.Struct({ paths: Schema.Array(Schema.String) })) })),
  }));
  for (const command of ['check', 'doctor']) {
    const output = yield* cli(root, ['--server=command', ...(command === 'check' ? ['--fresh'] : []), command]);
    const result = Schema.decodeUnknownSync(Diagnostic)(output.stdout);
    assert.equal(result.ok, true, command);
    assert.deepEqual(result.advisories.filter(item => item.code === 'WorkflowSkillsOutdated').map(item => item.details?.paths), [expected]);
    assert.equal(yield* fs.readFileString(join(root, changed)), old);
    assert.equal(yield* fs.readFileString(join(root, obsolete)), source);
  }
  const preview = receipt(yield* cli(root, ['--dry-run', 'skills', 'install']));
  assert.deepEqual(preview.removedPaths, [obsolete]);
  assert.equal(yield* fs.exists(join(root, obsolete)), true);
  const result = receipt(yield* cli(root, ['skills', 'install']));
  assert.deepEqual(result.removedPaths, [obsolete]);
  assert.deepEqual(result.updatedPaths, [changed]);
  assert.equal(yield* fs.exists(join(root, obsolete)), false);
  assert.equal(yield* fs.readFileString(join(root, untouched)), 'User owned skill.\n');
  yield* fs.writeFileString(join(root, obsolete), source);
  const human = yield* cli(root, ['skills', 'install'], 0, false);
  assert.match(human.stdout, /Removed:\n  \.agents\/skills\/concord-retired\/SKILL\.md/u);
})));

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
test('init and skills install publish eight ordinary skills, preserve managed files, and report updates without dry-run writes', { timeout: 90_000 }, () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const preview = yield* cli(root, ['--dry-run', 'init']);
  const initPreview = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ createdPaths: Schema.Array(Schema.String) })))(preview.stdout);
  for (const path of workflowSkillPaths) assert.ok(initPreview.createdPaths.includes(path));
  for (const path of ['docs', '.agents', '.claude', '.git/concord']) assert.equal(yield* fs.exists(join(root, path)), false, path);
  yield* cli(root, ['init']);
  for (const path of workflowSkillPaths) {
    assert.equal((yield* fs.stat(join(root, path))).type, 'File');
    const content = yield* fs.readFileString(join(root, path));
    const topic = /concord-([^/]+)\/SKILL.md$/u.exec(path)?.[1];
    assert.match(content, new RegExp(`^---\\nname: concord-${topic}\\ndescription: [^\\n]+\\n---\\n`, 'u'));
    assert.match(content, /^<!-- concord-managed version=[^\s<>]+ -->$/mu);
    assert.match(content, /AGENTS\.md/u);
    assert.ok(content.includes(`concord --skill ${topic}`));
    assert.match(content, /命令后的文字是本次任务/u);
    assert.equal(content, yield* fs.readFileString(join(root, path.replace('.agents/', '.claude/'))));
  }
  const unchanged = receipt(yield* cli(root, ['skills', 'install']));
  assert.deepEqual(unchanged, { operation: 'skills-install', dryRun: false, createdPaths: [], updatedPaths: [], removedPaths: [], unchangedPaths: workflowSkillPaths });
  const path = '.agents/skills/concord-spec/SKILL.md', original = yield* fs.readFileString(join(root, path));
  const outdated = `${original}\nOld managed content.\n`;
  yield* fs.writeFileString(join(root, path), outdated);
  const planned = receipt(yield* cli(root, ['--dry-run', 'skills', 'install']));
  assert.equal(planned.dryRun, true);
  assert.deepEqual(planned.updatedPaths, [path]);
  assert.equal(yield* fs.readFileString(join(root, path)), outdated);
  const updated = receipt(yield* cli(root, ['skills', 'install']));
  assert.deepEqual(updated.updatedPaths, [path]);
  assert.equal(updated.unchangedPaths.length, 7);
  assert.equal(yield* fs.readFileString(join(root, path)), original);
  const human = yield* cli(root, ['skills', 'install'], 0, false);
  assert.match(human.stdout, /^Unchanged:\n/u);
  assert.match(human.stdout, /Next: commit these files so everyone on the project gets the commands\./u);
})));

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
test('skills install previews creation without private state and init accepts existing managed skills', { timeout: 60_000 }, () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const taste = yield* fs.readFileString(resolve('templates/taste.md'));
  yield* fs.makeDirectory(join(root, 'docs'));
  yield* fs.writeFileString(join(root, 'docs/taste.md'), taste);
  const planned = receipt(yield* cli(root, ['--dry-run', 'skills', 'install']));
  assert.deepEqual(planned.createdPaths, workflowSkillPaths);
  assert.equal(yield* fs.exists(join(root, '.agents')), false);
  assert.equal(yield* fs.exists(join(root, '.git/concord')), false);
  assert.deepEqual(yield* fs.readDirectory(join(root, 'docs')), ['taste.md']);
  assert.equal(yield* fs.readFileString(join(root, 'docs/taste.md')), taste);
  const human = yield* cli(root, ['skills', 'install'], 0, false);
  assert.match(human.stdout, /^Created:\n/u);
  for (const path of workflowSkillPaths) assert.ok(human.stdout.includes(path));
  const uninitialized = join(root, 'uninitialized');
  yield* fs.makeDirectory(uninitialized);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner.exitCode(ChildProcess.make('git', ['init', '-q', uninitialized]));
  for (const directory of ['.agents', '.claude']) yield* fs.copy(join(root, directory), join(uninitialized, directory));
  assert.equal(yield* fs.exists(join(uninitialized, 'docs')), false);
  assert.equal(yield* fs.exists(join(uninitialized, '.git/concord')), false);
  yield* cli(uninitialized, ['init']);
  assert.equal(yield* fs.exists(join(uninitialized, 'docs/concord.md')), true);
})));

