import assert from 'node:assert/strict';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { Scope} from 'effect';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { digest, SkillsInstallReceiptSchema, workflowSkillPaths } from '../../src/model/index.ts';
import { tmpdir } from '../support/temporary.ts';
import { installedConcordCli } from '../support/support.ts';

type Requirements = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;
const entry = installedConcordCli();
const runCase = (body: (root: string) => Effect.Effect<void, unknown, Requirements>) => Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-workflow-skills-' });
    yield* spawner.exitCode(ChildProcess.make('git', ['init', '-q', root]));
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer)),
);
const cli = Effect.fn('test.workflowSkills.cli')(function*(root: string, args: string[], status = 0, json = true, executableEntry = entry) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [executableEntry, ...(args.includes('--skill') ? [] : ['--root', root]), ...(json ? ['--json'] : []), ...args], {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [stdout, stderr, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), status, JSON.stringify({ args, stdout, stderr, code }));
  return { stdout, stderr };
});
const receipt = (output: { stdout: string }) => Schema.decodeUnknownSync(Schema.fromJsonString(SkillsInstallReceiptSchema), { onExcessProperty: 'error' })(output.stdout);
const readError = (output: { stderr: string }) => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String, details: Schema.optional(Schema.Struct({ path: Schema.String })) })))(output.stderr);

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
    assert.match(content, /^<!-- concord-managed -->$/mu);
    assert.ok(content.includes(`concord --skill ${topic}`));
    assert.match(content, /命令后的文字是本次任务/u);
    assert.equal(content, yield* fs.readFileString(join(root, path.replace('.agents/', '.claude/'))));
  }
  const unchanged = receipt(yield* cli(root, ['skills', 'install']));
  assert.deepEqual(unchanged, { operation: 'skills-install', dryRun: false, createdPaths: [], updatedPaths: [], unchangedPaths: workflowSkillPaths });
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

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
test('occupied skill files, directories, broken links and ancestors reject init and install before any source write', { timeout: 120_000 }, () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scenarios = ['unmarked', 'directory', 'link', 'broken-link', 'ancestor-file', 'ancestor-link'] as const;
  for (const scenario of scenarios) {
    const project = join(root, scenario);
    yield* fs.makeDirectory(project);
    yield* spawner.exitCode(ChildProcess.make('git', ['init', '-q', project]));
    const first = join(project, workflowSkillPaths[0]!);
    yield* fs.makeDirectory(dirname(first), { recursive: true });
    const old = '<!-- concord-managed -->\nKeep old content when another path conflicts.\n';
    yield* fs.writeFileString(first, old);
    const target = scenario === 'ancestor-file' || scenario === 'ancestor-link' ? '.claude/skills' : '.claude/skills/concord-fix/SKILL.md';
    const absolute = join(project, target);
    yield* fs.makeDirectory(dirname(absolute), { recursive: true });
    if (scenario === 'unmarked') yield* fs.writeFileString(absolute, 'Mentioning concord-managed in a sentence does not grant ownership.\n');
    else if (scenario === 'directory') yield* fs.makeDirectory(absolute);
    else if (scenario === 'ancestor-file') yield* fs.writeFileString(absolute, 'not a directory');
    else {
      const outside = join(root, `outside-${scenario}`);
      if (scenario === 'ancestor-link') yield* fs.makeDirectory(outside);
      else if (scenario === 'link') yield* fs.writeFileString(outside, '<!-- concord-managed -->\nexternal');
      yield* fs.symlink(outside, absolute);
    }
    const taste = yield* fs.readFileString(resolve('templates/taste.md'));
    for (const args of [['init'], ['skills', 'install'], ['--dry-run', 'skills', 'install']]) {
      if (!args.includes('init') && !(yield* fs.exists(join(project, 'docs')))) {
        yield* fs.makeDirectory(join(project, 'docs'));
        yield* fs.writeFileString(join(project, 'docs/taste.md'), taste);
      }
      const error = readError(yield* cli(project, args, 1));
      assert.equal(error.error, 'SkillPathOccupied', scenario);
      assert.equal(error.details?.path, target, scenario);
      assert.equal(yield* fs.readFileString(first), old);
      if (args.includes('init')) assert.equal(yield* fs.exists(join(project, 'docs')), false);
      else {
        assert.deepEqual(yield* fs.readDirectory(join(project, 'docs')), ['taste.md']);
        assert.equal(yield* fs.readFileString(join(project, 'docs/taste.md')), taste);
      }
      assert.equal(yield* fs.exists(join(project, '.agents/skills/concord-implement')), false);
      assert.equal(yield* fs.exists(join(project, '.git/concord')), false);
    }
  }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md#完整路径
test('existing project and initialization conflicts retain priority over occupied workflow skills', { timeout: 45_000 }, () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = join(root, '.agents/skills/concord-spec/SKILL.md');
  yield* fs.makeDirectory(dirname(path), { recursive: true });
  yield* fs.writeFileString(path, 'user-owned');
  yield* fs.writeFileString(join(root, 'concord.config.ts'), 'export default {};\n');
  assert.equal(readError(yield* cli(root, ['init'], 1)).error, 'ProjectExists');
  yield* fs.remove(join(root, 'concord.config.ts'));
  yield* fs.makeDirectory(join(root, 'docs'));
  yield* fs.writeFileString(join(root, 'docs/concord.md'), 'existing document');
  assert.equal(readError(yield* cli(root, ['init'], 1)).error, 'InitializationConflict');
  assert.equal(yield* fs.readFileString(path), 'user-owned');
  assert.equal(yield* fs.exists(join(root, 'AGENTS.md')), false);
})));

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#follow
test('all four workflow topics are available outside a project through the source CLI', { timeout: 45_000 }, () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(join(root, '.git'), { recursive: true });
  for (const topic of ['spec', 'implement', 'review', 'fix']) {
    const result = yield* cli(root, ['--skill', topic], 0, false);
    assert.equal(result.stdout.trimEnd(), (yield* fs.readFileString(resolve(`skills/concord/references/${topic}.md`))).trimEnd());
  }
  assert.equal(yield* fs.exists(join(root, '.git')), false);
  assert.equal(yield* fs.exists(join(root, '.agents')), false);
})));

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
test('recover restores prepared workflow skills with documents and retains a committed eight-file publication', { timeout: 45_000 }, () => runCase(root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* cli(root, ['init']);
  for (const phase of ['prepared', 'committed'] as const) {
    const changes: { path: string; before: string; after: string; beforeDigest: string; afterDigest: string; mode: number }[] = [];
    for (const path of [...workflowSkillPaths, 'docs/concord.md']) {
      const before = yield* fs.readFileString(join(root, path)), after = `${before}\n`;
      changes.push({ path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 });
    }
    const journal = {
      format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'skills-install', phase, directories: [],
      scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') }, changes,
    };
    for (const change of phase === 'prepared' ? changes.slice(0, 4) : changes) yield* fs.writeFileString(join(root, change.path), change.after);
    yield* fs.writeFileString(join(root, '.git/concord/journal.json'), JSON.stringify(journal));
    const output = yield* cli(root, ['recover']);
    const result = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ changedPaths: Schema.Array(Schema.String) })))(output.stdout);
    assert.deepEqual([...result.changedPaths].sort(), changes.map(change => change.path).sort());
    for (const change of changes) assert.equal(yield* fs.readFileString(join(root, change.path)), phase === 'prepared' ? change.before : change.after);
    assert.equal(yield* fs.exists(join(root, '.git/concord/journal.json')), false);
  }
  for (const path of ['.agents/skills/concord-spec/EXTRA.md', '.claude/skills/concord-unknown/SKILL.md']) {
    const journal = JSON.stringify({
      format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'skills-install', phase: 'prepared', directories: [],
      scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') },
      changes: [{ path, before: null, after: 'not an authorized owner', beforeDigest: null, afterDigest: digest('not an authorized owner'), mode: 0o644 }],
    });
    const journalPath = join(root, '.git/concord/journal.json');
    yield* fs.writeFileString(journalPath, journal);
    assert.equal(readError(yield* cli(root, ['recover'], 1)).error, 'RecoveryConflict');
    assert.equal(yield* fs.readFileString(journalPath), journal);
    assert.equal(yield* fs.exists(join(root, path)), false);
    yield* fs.remove(journalPath);
  }
})));
