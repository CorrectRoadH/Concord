import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { scanAnnotations } from '../dist/annotations.js';
import { scanCode } from '../dist/code.js';
import { loadDocuments } from '../dist/documents.js';
import { LocalRepository } from '../dist/storage.js';
import { projectConfigPath, readProjectConfig } from './support.js';

const PackageVersion = Schema.Struct({ version: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('current checkout configures a version-matched runner whose annotations scan cleanly', () => Effect.runPromise(Effect.sync(() => {
  const root = resolve('.');
  const project = readProjectConfig(root);
  assert.equal(project.format, 'concord.project/v1');
  assert.deepEqual(project.testRoots, ['test']);
  assert.deepEqual(project.sourceRoots, ['src', 'repository', 'web', 'scripts']);
  assert.equal(project.runner.kind, 'command');
  if (project.runner.kind !== 'command') assert.fail('self-host runner must use explicit command argv');
  assert.deepEqual(project.runner.argv, ['node', '--import', 'tsx', 'scripts/test-built.ts', '--test-name-pattern', '{pattern}', '{file}']);
  assert.deepEqual(project.runner.sourceFiles, ['test/support.ts', 'test/e2e/fixtures.ts', 'test/e2e/engine.ts',
    'test/e2e/local-browser.ts', 'test/e2e/server.ts', 'test/e2e/journey.ts', 'e2e.config.ts',
    'scripts/test-built.ts', 'scripts/test-reporter.ts', 'tsconfig.test.json', 'package.json', 'pnpm-lock.yaml']);

  const packageVersion = Schema.decodeUnknownSync(Schema.fromJsonString(PackageVersion))(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const version = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `concord v${packageVersion}`);

  const consumer = realpathSync(mkdtempSync(join(tmpdir(), 'concord-selfhost-smoke-')));
  try {
    execFileSync('git', ['init', '-q', consumer]);
    const configPath = projectConfigPath(root);
    cpSync(join(root, configPath), join(consumer, configPath));
    const sources = new Set(['docs', ...project.testRoots, ...(project.sourceRoots ?? []),
      ...(project.memorySources ?? []).map(source => source.path), ...project.runner.sourceFiles]);
    for (const source of sources) {
      mkdirSync(dirname(join(consumer, source)), { recursive: true });
      cpSync(join(root, source), join(consumer, source), { recursive: true });
    }
    const repository = new LocalRepository(consumer);
    try {
      const scan = scanAnnotations(repository);
      assert.deepEqual(scan.findings, []);
      const useCases = loadDocuments(repository).filter(document => document.metadata.kind === 'use-case');
      assert.ok(useCases.length > 0, 'self-host contract inventory must contain at least one Use Case');
      for (const useCase of useCases) {
        assert.ok(scan.cases.some(item => item.contract.split('#')[0] === useCase.path), `missing a real test relation for ${useCase.path}`);
      }
      const code = scanCode(repository);
      assert.deepEqual(code.findings, []);
      assert.ok(code.codes.some(item => item.file === 'repository/engine.ts'), 'repository implementation must enter the self-host scan');
      assert.deepEqual(new Set(code.codes.map(item => item.scope)), new Set(['file', 'node', 'region']));
      const missingImplementations = useCases.filter(useCase => !code.codes.some(item => item.contracts.some(ref => ref.split('#')[0] === useCase.path))).map(useCase => useCase.path);
      assert.deepEqual(missingImplementations, [], 'every Use Case needs an actual implementation relation');
    } finally {
      repository.close();
    }
    const checked = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--root', consumer, '--json', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(checked.stdout).ok, true);
    const traced = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--root', consumer, '--json', 'trace', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(traced.status, 0, traced.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(traced.stdout).ok, true);
    const engine = join(consumer, 'repository/engine.ts');
    const source = readFileSync(engine, 'utf8');
    const invalid = source.replace('docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md', 'docs/feature/missing-selfhost/README.md');
    assert.notEqual(invalid, source);
    writeFileSync(engine, invalid);
    const rejected = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--root', consumer, '--json', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(rejected.stdout).ok, false);
    assert.match(rejected.stdout, /repository\/engine\.ts/u);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
})));
