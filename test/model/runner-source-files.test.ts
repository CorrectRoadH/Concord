import { withTypeScriptResource } from '../../src/base/process/index.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { API } from 'typescript/async';
import * as ts from 'typescript/ast';
import { ProjectSchema } from '../../src/model/index.ts';

// @feature docs/engineering/testing/architecture.md#runner-适配
test('runner config requires no manual sourceFiles and specifies direct argv', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const api = new API({ runExternalCode: false });
  await withTypeScriptResource({ dispose: () => api.close() }, async () => {
    const config = await api.createSourceFile(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8'));
    let project: typeof ProjectSchema.Type | undefined;
    await withTypeScriptResource(config, config => {
      const declaration = config.sourceFile.statements.find(ts.isExportAssignment);
      assert.ok(declaration);
      const unwrap = (node: ts.Expression): ts.Expression => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
      const value = unwrap(declaration.expression);
      project = ProjectSchema.make(JSON.parse(value.getText(config.sourceFile)));
    });
    assert.ok(project);
    assert.ok(project.runner);
    assert.equal(project.runner.sourceFiles, undefined);
    assert.equal(project.runner.prepare, undefined);
    assert.ok(project.runner.argv);
    assert.ok(project.runner.argv.includes('{file}'));
  });
})));
