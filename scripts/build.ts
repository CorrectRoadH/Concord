import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import ts from 'typescript';

class BuildFailed extends Schema.TaggedError<BuildFailed>()('BuildFailed', {
  project: Schema.String,
  exitCode: Schema.Number,
}) {}

// These pinned packages expose side-effect-free namespace barrels and matching
// public subpaths. Preserve module identity while avoiding unrelated services at
// CLI startup. Transform during emit so declarations and source maps stay intact.
const namespaceBarrels = new Set(['effect', '@effect/platform-node', 'effect/unstable/cli', 'effect/unstable/process']);
const narrowNamespaceImports: ts.TransformerFactory<ts.SourceFile> = context => source => {
  const statements = source.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !namespaceBarrels.has(statement.moduleSpecifier.text)) return [statement];
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return [statement];
    const imports = clause.namedBindings.elements.filter(binding => !binding.isTypeOnly);
    if (imports.length === 0) return [statement];
    return imports.map(binding => ts.setOriginalNode(ts.setTextRange(context.factory.createImportDeclaration(
      statement.modifiers,
      context.factory.createImportClause(false, undefined, context.factory.createNamespaceImport(binding.name)),
      context.factory.createStringLiteral(`${(statement.moduleSpecifier as ts.StringLiteral).text}/${(binding.propertyName ?? binding.name).text}`),
      statement.attributes,
    ), statement), statement));
  });
  return context.factory.updateSourceFile(source, statements);
};

function compile(project: string): number {
  const diagnostics: ts.Diagnostic[] = [];
  const config = ts.getParsedCommandLineOfConfigFile(project, { noEmitOnError: true }, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => diagnostics.push(diagnostic),
  });
  if (config) {
    const program = ts.createProgram({ rootNames: config.fileNames, options: config.options, projectReferences: config.projectReferences });
    diagnostics.push(...config.errors, ...ts.getPreEmitDiagnostics(program));
    if (diagnostics.length === 0) diagnostics.push(...program.emit(undefined, undefined, undefined, undefined, { before: [narrowNamespaceImports] }).diagnostics);
  }
  if (diagnostics.length > 0) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory, getCanonicalFileName: file => file, getNewLine: () => ts.sys.newLine,
  }));
  return config && diagnostics.length === 0 ? 0 : 1;
}

const build = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove('dist', { recursive: true, force: true });
  const nativeArgs = ['--import', 'tsx', 'scripts/build-native.ts', '--output', 'dist/native'];
  const prebuilt = process.env.CONCORD_NATIVE_ARTIFACTS;
  if (prebuilt !== undefined) nativeArgs.push('--prebuilt', prebuilt);
  if (process.env.CONCORD_REQUIRE_PORTABLE_NATIVE === '1') nativeArgs.push('--require-portable');
  const nativeExit = yield* spawner.exitCode(ChildProcess.make(process.execPath, nativeArgs, { stdout: 'inherit', stderr: 'inherit' }));
  if (nativeExit !== 0) return yield* new BuildFailed({ project: 'hawdb-native', exitCode: nativeExit });
  for (const project of ['tsconfig.json', 'tsconfig.repository.json', 'tsconfig.web.json']) {
    const exitCode = yield* Effect.sync(() => compile(project));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  }
  const webExit = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdout: 'inherit', stderr: 'inherit' }));
  if (webExit !== 0) return yield* new BuildFailed({ project: 'web', exitCode: webExit });
  yield* fs.copyFile('node_modules/@fontsource-variable/noto-sans-sc/LICENSE', 'dist/web/FONT-LICENSE.txt');
  yield* fs.remove('dist/repository/host-types', { recursive: true, force: true });
  yield* fs.copy('repository/host-types', 'dist/repository/host-types');
  yield* fs.chmod('dist/entry.js', 0o755);
  yield* fs.chmod('dist/cli.js', 0o755);
});

build.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
