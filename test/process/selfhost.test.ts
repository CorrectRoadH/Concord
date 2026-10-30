import { installedConcordCli } from '../support/support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { scanAnnotations } from "../../src/domain/tests/index.js";
import { scanCode } from "../../src/domain/code/index.js";
import { inlineLinks, relativeMarkdownLink } from "../../src/domain/constitution/index.js";
import { traceGaps } from "../../src/app/index.js";
import { loadDocuments } from "../../src/domain/documents/index.js";
import { LocalRepository } from "../support/repository.js";
import { readWritingPolicy } from "../../src/domain/writing/index.js";
import { projectConfigPath, readProjectConfig } from '../support/support.js';

const PackageVersion = Schema.Struct({ version: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('current checkout configures a version-matched runner whose annotations scan cleanly', () => Effect.runPromise(Effect.sync(() => {
  const root = resolve(".");
  const project = readProjectConfig(root);
  assert.equal('format' in project, false);
  assert.deepEqual(project.testRoots, ['test']);
  assert.deepEqual(project.sourceRoots, ['src', 'web', 'scripts']);
  assert.ok(project.runner);
  assert.equal(project.runner.kind, 'command');
  if (project.runner.kind !== 'command') assert.fail('self-host runner must use explicit command argv');
  assert.deepEqual(project.runner.argv, ['node', '--import', 'tsx', 'scripts/test-built.ts', '--test-name-pattern', '{pattern}', '{file}']);
  assert.deepEqual(project.runner.sourceFiles, ['test/support/support.ts', 'test/support/installed-package.ts', 'test/support/repository.ts', 'test/support/temporary.ts', 'test/support/cli-fixture.ts', 'test/support/asynchronous-projections-fixture.ts', 'test/support/lsp-analysis-fixture.ts', 'test/support/issue-remote-fixture.ts', 'test/support/test-adapters-consumer-fixture.ts', 'test/e2e/fixtures.ts', 'test/e2e/engine.ts',
    'test/e2e/local-browser.ts', 'test/e2e/server.ts', 'test/e2e/journey.ts', 'e2e.config.ts',
    'scripts/test-built.ts', 'scripts/test-reporter.ts', 'tsconfig.test.json', 'package.json', 'pnpm-lock.yaml']);

  const packageVersion = Schema.decodeUnknownSync(Schema.fromJsonString(PackageVersion))(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const version = spawnSync(process.execPath, [installedConcordCli(), '--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `concord v${packageVersion}`);

  const consumer = realpathSync(mkdtempSync(join(tmpdir(), 'concord-selfhost-smoke-')));
  try {
    execFileSync('git', ['init', '-q', consumer]);
    const configPath = projectConfigPath(root);
    cpSync(join(root, configPath), join(consumer, configPath));
    // The global writing policy may select prose outside docs (READMEs, skills, templates).
    const writingRoots = readWritingPolicy(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).roots ?? [];
    const sources = new Set(['docs', ...(project.testRoots ?? ['test']), ...(project.sourceRoots ?? []),
      'memory', ...(project.runner?.sourceFiles ?? []), ...writingRoots]);
    for (const source of sources) {
      mkdirSync(dirname(join(consumer, source)), { recursive: true });
      cpSync(join(root, source), join(consumer, source), { recursive: true });
    }
    const repository = new LocalRepository(consumer);
    try {
      const scan = scanAnnotations(repository);
      assert.deepEqual(scan.findings, []);
      const documents = loadDocuments(repository);
      const useCases = documents.filter(document => document.metadata.kind === 'use-case');
      assert.ok(useCases.length > 0, 'self-host contract inventory must contain at least one Use Case');
      const code = scanCode(repository);
      assert.deepEqual(code.findings, []);
      assert.ok(code.codes.some(item => item.file === 'src/base/workspace/storage.ts'), 'configured source roots must enter the self-host scan');
      assert.deepEqual(new Set(code.codes.map(item => item.scope)), new Set(['file', 'node', 'region']));
      const tracked = new Set(documents.flatMap(issue => issue.metadata.kind !== 'issue' || issue.metadata.status !== 'open' ? [] : inlineLinks(issue.body, issue.path).flatMap(link => {
        const target = relativeMarkdownLink(issue.path, link.url);
        return target?.kind === 'relative' && !target.query ? [target.path] : [];
      })));
      for (const gap of traceGaps(repository, 'off').contracts.filter(gap => gap.kind === 'use-case')) {
        const owner = useCases.find(useCase => useCase.path === gap.path)!;
        assert.ok(owner.metadata.kind === 'use-case');
        assert.ok(tracked.has(owner.path) || tracked.has(owner.metadata.feature), `trace gap lacks an open Issue linking its Use Case or Feature: ${owner.path}`);
      }
    } finally {
      repository.close();
    }
    const checked = spawnSync(process.execPath, [installedConcordCli(), '--root', consumer, '--json', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(checked.stdout).ok, true);
    const traced = spawnSync(process.execPath, [installedConcordCli(), '--root', consumer, '--json', 'trace', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(traced.status, 0, traced.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(traced.stdout).ok, true);
    const engine = join(consumer, 'src/base/workspace/storage.ts');
    const source = readFileSync(engine, 'utf8');
    const invalid = source.replace('docs/feature/portable-coordination/architecture.md#invariants', 'docs/feature/missing-selfhost/README.md');
    assert.notEqual(invalid, source);
    writeFileSync(engine, invalid);
    const rejected = spawnSync(process.execPath, [installedConcordCli(), '--root', consumer, '--json', 'check'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CheckOutput), { onExcessProperty: 'ignore' })(rejected.stdout).ok, false);
    assert.match(rejected.stdout, /src\/base\/workspace\/storage\.ts/u);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
})));
