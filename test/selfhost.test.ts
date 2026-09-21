import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  assert.deepEqual(project.sourceRoots, ['src', 'web']);
  assert.equal(project.runner.kind, 'command');
  if (project.runner.kind !== 'command') assert.fail('self-host runner must use explicit command argv');
  assert.deepEqual(project.runner.argv, ['node', '--import', 'tsx', '--test', '--test-name-pattern', '{pattern}', '{file}']);
  assert.deepEqual(project.runner.sourceFiles, ['test/support.ts', 'tsconfig.test.json', 'package.json', 'pnpm-lock.yaml']);

  const packageVersion = Schema.decodeUnknownSync(Schema.fromJsonString(PackageVersion))(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const version = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `concord v${packageVersion}`);

  const consumer = mkdtempSync(join(tmpdir(), 'concord-selfhost-smoke-'));
  try {
    execFileSync('git', ['init', '-q', consumer]);
    const configPath = projectConfigPath(root);
    cpSync(join(root, configPath), join(consumer, configPath));
    for (const source of project.memorySources ?? []) cpSync(join(root, source.path), join(consumer, source.path), { recursive: true });
    mkdirSync(join(consumer, 'test'));
    cpSync(join(root, 'test'), join(consumer, 'test'), { recursive: true });
    cpSync(join(root, 'src'), join(consumer, 'src'), { recursive: true });
    cpSync(join(root, 'web'), join(consumer, 'web'), { recursive: true });
    mkdirSync(join(consumer, 'docs'));
    if (project.constitution !== undefined) cpSync(join(root, project.constitution.path), join(consumer, project.constitution.path));
    cpSync(join(root, 'docs/feature'), join(consumer, 'docs/feature'), { recursive: true });
    for (const sourceFile of ['tsconfig.test.json', 'package.json', 'pnpm-lock.yaml']) {
      cpSync(join(root, sourceFile), join(consumer, sourceFile));
    }
    const repository = new LocalRepository(consumer);
    try {
      const scan = scanAnnotations(repository);
      assert.deepEqual(scan.findings, []);
      const useCases = loadDocuments(repository).filter(document => document.metadata.kind === 'use-case');
      assert.ok(useCases.length > 0, 'self-host contract inventory must contain at least one Use Case');
      for (const useCase of useCases) {
        assert.ok(scan.cases.some(item => item.contract === useCase.path), `missing a real test relation for ${useCase.path}`);
      }
      const code = scanCode(repository);
      assert.deepEqual(code.findings, []);
      assert.deepEqual(new Set(code.codes.map(item => item.scope)), new Set(['file', 'node', 'region']));
      for (const useCase of useCases) {
        assert.ok(code.codes.some(item => item.contracts.includes(useCase.path)), `missing an implementation relation for ${useCase.path}`);
      }
    } finally {
      repository.close();
    }
    const checked = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--root', consumer, '--json', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(checked.stdout).ok, true);
    const traced = spawnSync(process.execPath, [join(root, 'dist/entry.js'), '--root', consumer, '--json', 'trace', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(traced.status, 0, traced.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(traced.stdout).ok, true);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
})));
