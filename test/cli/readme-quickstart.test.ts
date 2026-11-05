import { packageBin } from '../../scripts/package-location.js';
import { sourceConcord, prepareSourceConsumer } from '../support/installed-package.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { CodeDeclarationSchema } from "../../src/model/index.js";
import { ProjectSchema } from "../../src/model/index.js";
import { readProjectConfig, writeProjectConfig } from '../support/support.js';
import { caseDiscriminator, deriveTestReference } from "../../src/model/index.js";

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('the shipped README quick start executes through the built bin and traces its exact snippets', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {
    const packed = sourceConcord();
    assert.ok(packed);
    const install = join(scratch, 'tool'); mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
    prepareSourceConsumer(install, packed);
    const cli = packageBin(join(install, 'node_modules/concord-sdlc'));
    const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
    const skill = spawnSync(process.execPath, [cli, '--skill', 'code'], { cwd: scratch, encoding: 'utf8', timeout: 10000 });
    assert.equal(skill.status, 0, skill.stderr); assert.match(skill.stdout, /code at/);

    // Execute the shipped quick start itself; copied examples cannot prove the README works.
    const readme = readFileSync(join(install, 'node_modules/concord-sdlc/README.md'), 'utf8');
    const quickStart = readme.split('## Quick start\n')[1]?.split('\n## ')[0];
    const script = quickStart === undefined ? undefined : /```sh\n([\s\S]*?)\n```/u.exec(quickStart)?.[1];
    assert.ok(script, 'README must contain a runnable quick start');
    const demo = join(scratch, 'concord-demo'); mkdirSync(demo);
    execFileSync('git', ['init', '-q', demo]);
    const demoRun = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: demo, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PATH: `${join(install, 'node_modules/.bin')}:${process.env.PATH ?? ''}` },
    });
    assert.equal(demoRun.status, 0, demoRun.stdout + demoRun.stderr);
    // Quick start assumes an existing Git repository and shows source/test annotations separately.
    const snippets = [...quickStart!.matchAll(/```ts\n([\s\S]*?)\n```/gu)].map(match => match[1]!);
    assert.equal(snippets.length, 2);
    mkdirSync(join(demo, 'src')); mkdirSync(join(demo, 'test'));
    writeFileSync(join(demo, 'src/greeting.ts'), snippets[0]!);
    writeFileSync(join(demo, 'test/greeting.test.ts'), `${snippets[1]}\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/greeting.ts';\ntest('greet', () => assert.equal(greet('world'), 'Hello, world!'));\n`);
    const demoCheck = spawnSync(process.execPath, [cli, '--root', demo, '--json', 'check'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(demoCheck.status, 0, demoCheck.stderr);
    assert.deepEqual(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int })))(demoCheck.stdout), { ok: true, codeDeclarations: 1, cases: 1 });
    const demoLocate = spawnSync(process.execPath, [cli, '--root', demo, '--json', 'code', 'at', 'src/greeting.ts:3'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(demoLocate.status, 0, demoLocate.stderr);
    assert.deepEqual(new Set(Schema.decodeUnknownSync(Schema.fromJsonString(codes))(demoLocate.stdout).codes.map(item => item.scope)), new Set(['node']));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
