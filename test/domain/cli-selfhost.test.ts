import { executeQuery } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { readWritingPolicy } from "../../src/domain/writing/index.ts";
import { projectConfigPath, readProjectConfig } from '../support/support.ts';

const CheckOutput = Schema.Struct({ ok: Schema.Boolean });

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('self-host application checks accept the checkout and reject a broken implementation reference', () => Effect.runPromise(Effect.promise(async () => {
  const root = resolve(".");
  const project = readProjectConfig(root);
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
    const checked = await runApplication(executeQuery(consumer, { name: 'check', input: {} }, 'use'));
    assert.equal(checked.exitCode, 0);
    assert.equal(Schema.decodeUnknownSync(CheckOutput)(checked.value).ok, true);
    const traced = await runApplication(executeQuery(consumer, { name: 'trace.check', input: {} }, 'use'));
    assert.equal(traced.exitCode, 0);
    assert.equal(Schema.decodeUnknownSync(CheckOutput)(traced.value).ok, true);
    const engine = join(consumer, 'src/base/workspace/storage.ts');
    const source = readFileSync(engine, 'utf8');
    const invalid = source.replace('docs/feature/portable-coordination/architecture.md#invariants', 'docs/feature/missing-selfhost/README.md');
    assert.notEqual(invalid, source);
    writeFileSync(engine, invalid);
    const rejected = await runApplication(executeQuery(consumer, { name: 'check', input: {} }, 'use'));
    assert.equal(rejected.exitCode, 1);
    assert.equal(Schema.decodeUnknownSync(CheckOutput)(rejected.value).ok, false);
    assert.match(JSON.stringify(rejected.value), /src\/base\/workspace\/storage\.ts/u);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
})));
