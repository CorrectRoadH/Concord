import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { scanAnnotations } from "../../src/domain/tests/index.ts";
import { scanCode } from "../../src/domain/code/index.ts";
import { loadDocuments } from "../../src/domain/documents/index.ts";
import { LocalRepository } from "../support/repository.ts";
import { readWritingPolicy } from "../../src/domain/writing/index.ts";
import { projectConfigPath, readProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('current checkout configures a version-matched runner whose annotations scan cleanly', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = resolve('.');
  const project = (await readProjectConfig(root));
  assert.equal('format' in project, false);
  assert.deepEqual(project.testRoots, ['test']);
  assert.deepEqual(project.sourceRoots, ['src', 'web', 'scripts']);
  assert.ok(project.runner);
  assert.equal(project.runner.kind, 'command');
  if (project.runner.kind !== 'command') assert.fail('self-host runner must use explicit command argv');
  assert.deepEqual(project.runner.argv, ['node', 'scripts/test-built.ts', '--test-name-pattern', '{pattern}', '{file}']);
  assert.equal(new Set(project.runner.sourceFiles).size, project.runner.sourceFiles.length);

    const repository = (await LocalRepository.open(root));
    try {
      const scan = (await scanAnnotations(repository));
      assert.deepEqual(scan.findings, []);
      const documents = loadDocuments(repository);
      const useCases = documents.filter(document => document.metadata.kind === 'use-case');
      assert.ok(useCases.length > 0, 'self-host contract inventory must contain at least one Use Case');
      const code = (await scanCode(repository));
      assert.deepEqual(code.findings, []);
      assert.ok(code.codes.some(item => item.file === 'src/base/workspace/storage.ts'), 'configured source roots must enter the self-host scan');
      assert.deepEqual(new Set(code.codes.map(item => item.scope)), new Set(['file', 'node', 'region']));
    } finally {
      repository.close();
    }
})));
