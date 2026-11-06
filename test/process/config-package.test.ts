// 跨进程保证：外部程序——真实消费者 tsc 解析公开源码类型出口，合法配置编译成功，拼错字段保留原诊断。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { prepareSourceConsumer } from '../support/source-consumer.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('source config has usable type hints and rejects misspelled fields', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-config-package-'));
  try {
    const project = join(scratch, 'consumer'); mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    prepareSourceConsumer(project, ['typescript@7.1.0-beta', '@types/node@24.13.3']);
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext', customConditions: ['concord-source'], noEmit: true }, include: ['concord.config.ts'] }));
    const valid = `import type { ProjectConfig } from 'concord-sdlc/config';\nexport default { testRoots: [], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 1000 } } as const satisfies ProjectConfig;\n`;
    writeFileSync(join(project, 'concord.config.ts'), valid);
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: project, encoding: 'utf8', timeout: 30_000 });
    writeFileSync(join(project, 'concord.config.ts'), valid.replace("testRoots: []", "testRoots: [], testRoot: []"));
    const invalid = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: project, encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
    assert.match(invalid.stdout + invalid.stderr, /'testRoot' does not exist in type 'ProjectConfig'/u);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
