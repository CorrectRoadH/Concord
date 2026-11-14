import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { scanAnnotations } from "../../src/domain/tests/index.ts";
import { scanCode } from "../../src/domain/code/index.ts";
import { loadDocuments } from "../../src/domain/documents/index.ts";
import { LocalRepository } from "../support/repository.ts";
import { readProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('current checkout source and test roots scan cleanly without execution configuration', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = resolve('.');
  const project = (await readProjectConfig(root));
  assert.equal('format' in project, false);
  assert.deepEqual(project.testRoots, ['test']);
  assert.deepEqual(project.sourceRoots, ['src', 'web', 'scripts']);
  assert.equal('runner' in project, false);

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
