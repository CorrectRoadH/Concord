import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { ProjectSchema } from '../../src/model/index.ts';

// @feature docs/engineering/testing/architecture.md#runner-适配
test('runner sourceFiles equals the static closure of test and runner entrypoints', () => Effect.runPromise(Effect.sync(() => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = new Set(globSync(['test/**/*.ts', 'scripts/**/*.ts', 'src/**/*.ts', 'web/**/*.ts', 'web/**/*.tsx', 'bench/**/*.ts', '*.ts'], { cwd: root }));
  const api = new API({ runExternalCode: false });
  const tests = new Set([...files].filter(file => /\.(?:test|e2e)\.ts$/u.test(file)));
  const invalid: string[] = [];
  const local = (file: string, path: string): string | undefined => {
    const target = relative(root, resolve(root, dirname(file), path)).replace(/\.js$/u, '.ts');
    return [target, `${target}.ts`, `${target}/index.ts`].find(candidate => files.has(candidate));
  };
  try {
    // Read the owner declaration without importing the configuration into its own graph.
    const config = api.createSourceFile(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8'));
    let project: typeof ProjectSchema.Type | undefined;
    try {
      const declaration = config.sourceFile.statements.find(ts.isExportAssignment);
      assert.ok(declaration);
      const unwrap = (node: ts.Expression): ts.Expression => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
      const value = unwrap(declaration.expression);
      // The config owner uses a literal object; JSON decoding cannot execute consumer code.
      project = ProjectSchema.make(JSON.parse(value.getText(config.sourceFile)));
    } finally { config.dispose(); }
    const pending = [...tests, 'e2e.config.ts'];
    for (const command of [project.runner!.kind === 'command' ? project.runner!.argv : [], ...project.runner!.prepare ?? []]) {
      for (const argument of command) if (files.has(argument)) pending.push(argument);
    }
    const reachable = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (reachable.has(file) || file.startsWith('src/') || file === 'concord.config.ts') continue;
      reachable.add(file);
      const targets = new Set<string>();
      const source = api.createSourceFile(join(root, file), readFileSync(join(root, file), 'utf8'), { scriptKind: file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS });
      try {
        const addRelative = (path: string): void => {
          if (!path.startsWith('.')) return;
          const target = local(file, path);
          if (target !== undefined) targets.add(target);
          else if (/\.[cm]?[jt]sx?$/u.test(path)) invalid.push(`${file}: unresolved ${path}`);
        };
        const visit = (node: ts.Node): void => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addRelative(node.moduleSpecifier.text);
          if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) addRelative(node.argument.literal.text);
          if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0]) && /\.[cm]?[jt]sx?$/u.test(node.arguments[0].text)) addRelative(node.arguments[0].text);
          // Literal checkout paths used by resolve(), --import, and child entry arrays.
          if (ts.isStringLiteral(node) && /^(?:test|scripts|bench|src)\/.*\.[cm]?[jt]sx?$/u.test(node.text) && files.has(node.text)) targets.add(node.text);
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const argument = node.arguments[0];
            if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) addRelative(argument.text);
            else {
              const text = argument?.getText(source.sourceFile);
              if (file === 'scripts/perf/scenario.ts' && text === "pathToFileURL(join(root, 'bench', name)).href") {
                for (const candidate of files) if (/^bench\/[^/]+\.bench\.ts$/u.test(candidate)) targets.add(candidate);
              } else if (file === 'scripts/startup-build.ts' && text === 'pathToFileURL(resolve(file)).href') {
                // startup-build owns this generated product entry; its source is excluded.
                assert.match(readFileSync(join(root, file), 'utf8'), /const file = dist\('entry\/cli\/cli-full\.js'\)/u);
                targets.add('src/entry/cli/cli-full.ts');
              } else if (file === 'test/process/herdr-writing-guide.test.ts' && text === "pathToFileURL(resolve('src/entry/herdr-mod/main.ts')).href") targets.add('src/entry/herdr-mod/main.ts');
              else if (file === 'scripts/herdr-mod-host.ts' && text === 'mod') {
                // Both branches load the same product module, from source or its packaged copy.
                assert.match(readFileSync(join(root, file), 'utf8'), /new URL\('\.\.\/src\/entry\/herdr-mod\/main\.ts', import\.meta\.url\)/u);
                targets.add('src/entry/herdr-mod/main.ts');
              } else invalid.push(`${file}: cannot enumerate import(${text})`);
            }
          }
          node.forEachChild(visit);
        };
        visit(source.sourceFile);
      } finally { source.dispose(); }
      pending.push(...targets);
    }
    assert.deepEqual(invalid, [], 'Every module load must have a statically enumerable target');
    const expected = [...new Set([
      ...[...reachable].filter(file => !tests.has(file)),
      '.bun-version', '.node-version', 'native-release.json', 'package.json', 'pnpm-lock.yaml', 'tsconfig.test.json',
    ])].sort();
    assert.deepEqual([...project.runner!.sourceFiles].sort(), expected);
  } finally { api.close(); }
})));
