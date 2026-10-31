import { installedConcordCli } from '../support/support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { readWritingPolicy } from "../../src/domain/writing/index.js";
import { projectConfigPath, readProjectConfig } from '../support/support.js';

const PackageVersion = Schema.Struct({ version: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed self-host commands accept the checkout and reject a broken implementation reference', () => Effect.runPromise(Effect.sync(() => {
  const root = resolve(".");
  const project = readProjectConfig(root);
  const packageVersion = Schema.decodeUnknownSync(Schema.fromJsonString(PackageVersion))(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const version = spawnSync(process.execPath, [installedConcordCli(), '--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `concord v${packageVersion}`);

  const consumer = realpathSync(mkdtempSync(join(tmpdir(), 'concord-selfhost-smoke-')));
  try {
    execFileSync('git', ['init', '-q', consumer]);
    // Closed Issues retain verification commits; the copied consumer needs the
    // same local history to validate those records in cache-off source reads.
    execFileSync('git', ['-C', consumer, 'fetch', '-q', '--no-tags', root, 'HEAD']);
    const configPath = projectConfigPath(root);
    cpSync(join(root, configPath), join(consumer, configPath));
    // The global writing policy may select prose outside docs (READMEs, skills, templates).
    const writingRoots = readWritingPolicy(readFileSync(join(root, 'docs/writing.md'), 'utf8')).roots ?? [];
    const sources = new Set(['docs', ...(project.testRoots ?? ['test']), ...(project.sourceRoots ?? []),
      'memory', ...(project.runner?.sourceFiles ?? []), ...writingRoots]);
    for (const source of sources) {
      mkdirSync(dirname(join(consumer, source)), { recursive: true });
      cpSync(join(root, source), join(consumer, source), { recursive: true });
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
