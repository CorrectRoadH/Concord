// 跨进程保证：外部程序——原文 README 的完整 bash 链经公开 bin 执行，并以原文 TypeScript 片段验证 check/code at 的真实结果。
import { existsSync } from 'node:fs';
import { sourceCli } from '../support/source-consumer.ts';
import { sourceRoot, prepareSourceConsumer } from '../support/source-consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { runCli } from '../support/cli.ts';
import { stopCliWorkspace } from '../support/cli-complex-fixture.ts';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { CodeDeclarationSchema } from "../../src/model/index.ts";

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('the shipped README quick start executes through the built bin and traces its exact snippets', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  const demo = join(scratch, 'concord-demo');
  try {

    assert.ok(existsSync(sourceCli()));
    const install = join(scratch, 'tool'); mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
    prepareSourceConsumer(install);
    const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });

    // Execute the shipped quick start itself; copied examples cannot prove the README works.
    const readme = readFileSync(join(sourceRoot, 'README.md'), 'utf8');
    const quickStart = readme.split('## Quick start\n')[1]?.split('\n## ')[0];
    const script = quickStart === undefined ? undefined : /```sh\n([\s\S]*?)\n```/u.exec(quickStart)?.[1];
    assert.ok(script, 'README must contain a runnable quick start');
    mkdirSync(demo);
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
    const demoCheck = await runCli({ argv: ['--root', demo, '--json', 'check'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(10000) });
    assert.equal(demoCheck.exitCode, 0, demoCheck.stderr);
    assert.deepEqual(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int })))(demoCheck.stdout), { ok: true, codeDeclarations: 1, cases: 1 });
    const demoLocate = await runCli({ argv: ['--root', demo, '--json', 'code', 'at', 'src/greeting.ts:3'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(10000) });
    assert.equal(demoLocate.exitCode, 0, demoLocate.stderr);
    assert.deepEqual(new Set(Schema.decodeUnknownSync(Schema.fromJsonString(codes))(demoLocate.stdout).codes.map(item => item.scope)), new Set(['node']));
  } finally { await stopCliWorkspace(demo); rmSync(scratch, { recursive: true, force: true }); }
})));
