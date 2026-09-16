import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { parseTypeScriptConfig, renderTypeScriptConfig } from '../dist/config.js';
import { digest } from '../dist/shared.js';
import { LocalRepository, initialize } from '../dist/storage.js';

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('packed config has usable type hints and rejects misspelled fields', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-config-package-'));
  try {
    const packed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ filename: Schema.String }))))(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 }),
    );
    const project = join(scratch, 'consumer'); mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, packed[0]!.filename)], { cwd: project, encoding: 'utf8', timeout: 60_000 });
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true }, include: ['concord.config.ts'] }));
    const valid = `import type { ProjectConfig } from 'concord-sdlc/config';\nexport default { format: 'concord.project/v1', projectId: 'typed', testRoots: [], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 1000 } } as const satisfies ProjectConfig;\n`;
    writeFileSync(join(project, 'concord.config.ts'), valid);
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: project, encoding: 'utf8', timeout: 30_000 });
    writeFileSync(join(project, 'concord.config.ts'), valid.replace("projectId: 'typed'", "projectId: 'typed', projectID: 'misspelled'"));
    const invalid = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: project, encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('prepared config recovery restores the frozen source bytes', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-config-recovery-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    repo = new LocalRepository(root, { initialize: true }); initialize(repo); repo.close(); repo = undefined;
    const path = 'concord.config.ts', before = readFileSync(join(root, path), 'utf8');
    const config = parseTypeScriptConfig(before);
    const after = `// normalized later\n${renderTypeScriptConfig({ ...config, testRoots: [] })}`;
    const privateDir = join(root, '.git', 'concord');
    const journal = { format: 'concord.journal', root, privateDir, projectId: config.projectId, operation: 'set-config', phase: 'prepared', directories: [], scope: { kind: 'documents', configPath: path, configSource: before, configDigest: digest(before) }, changes: [{ path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 }] };
    writeFileSync(join(root, path), after);
    writeFileSync(join(privateDir, 'journal.json'), `${JSON.stringify(journal)}\n`);
    repo = new LocalRepository(root, { recover: true });
    assert.equal(repo.recover().status, 'rolled-back');
    assert.equal(readFileSync(join(root, path), 'utf8'), before);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
