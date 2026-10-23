import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { build as bundle } from 'esbuild';
import { P5_LIBRARIES } from '../src/p5-contract.js';

class BuildFailed extends Schema.TaggedError<BuildFailed>()('BuildFailed', {
  project: Schema.String,
  exitCode: Schema.Number,
}) {}

// These pinned packages expose side-effect-free namespace barrels and matching
// public subpaths. Preserve module identity while avoiding unrelated services at
// CLI startup. Rewrite only emitted JS and remove mappings for rewritten lines.
const namespaceBarrels = new Set(['effect', '@effect/platform-node', 'effect/unstable/cli', 'effect/unstable/process']);

class BuildOutputFailed extends Schema.TaggedError<BuildOutputFailed>()('BuildOutputFailed', {
  file: Schema.String,
  message: Schema.String,
}) {}

const SourceMapSchema = Schema.Struct({
  version: Schema.Literal(3),
  file: Schema.optional(Schema.String),
  sourceRoot: Schema.optional(Schema.String),
  sources: Schema.Array(Schema.String),
  sourcesContent: Schema.optional(Schema.Array(Schema.NullOr(Schema.String))),
  names: Schema.Array(Schema.String),
  mappings: Schema.String,
});

function narrowNamespaceImports(api: API, file: string): void {
  const text = readFileSync(file, 'utf8');
  const retained = api.createSourceFile(file, text, { scriptKind: ts.ScriptKind.JS });
  const edits: { start: number; end: number; text: string; firstLine: number; lastLine: number }[] = [];
  try {
    const source = retained.sourceFile;
    const lines = source.getLineStarts();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !namespaceBarrels.has(statement.moduleSpecifier.text)) continue;
      const clause = statement.importClause;
      if (!clause || clause.phaseModifier !== undefined || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
      const imports = clause.namedBindings.elements.filter(binding => !binding.isTypeOnly);
      if (imports.length === 0) continue;
      const first = statement.getStart(source), last = statement.getEnd();
      const firstLine = source.getLineAndCharacterOfPosition(first).line;
      const lastLine = source.getLineAndCharacterOfPosition(last - 1).line;
      const start = lines[firstLine]!, end = lines[lastLine + 1] ?? text.length;
      if (text.slice(start, first).trim() || text.slice(last, end).trim()) {
        throw new BuildOutputFailed({ file, message: 'A narrowed import must occupy whole generated lines without another statement or trailing comment' });
      }
      const attributes = statement.attributes === undefined ? '' : ` ${statement.attributes.getText(source)}`;
      const module = statement.moduleSpecifier.text;
      const replacement = imports.map(binding => `import * as ${binding.name.text} from ${JSON.stringify(`${module}/${(binding.propertyName ?? binding.name).text}`)}${attributes};`).join(' ');
      if (/[\r\n\u2028\u2029]/u.test(replacement)) throw new BuildOutputFailed({ file, message: 'A narrowed import replacement must fit on one generated line' });
      // Keep every original line ending, including blank lines inside a multiline import.
      const endings = text.slice(start, end).match(/\r\n|[\r\n\u2028\u2029]/gu) ?? [];
      edits.push({ start, end, text: replacement + endings.join(''), firstLine, lastLine });
    }
  } finally { retained.dispose(); }
  if (edits.length === 0) return;
  const mapPath = `${file}.map`;
  let nextMap: string | undefined;
  if (existsSync(mapPath)) {
    const map = Schema.decodeUnknownSync(SourceMapSchema, { onExcessProperty: 'error' })(JSON.parse(readFileSync(mapPath, 'utf8')));
    // decode resolves all cross-line source/name deltas before any line is removed.
    const mappings = decode(map.mappings);
    for (const edit of edits) for (let line = edit.firstLine; line <= edit.lastLine && line < mappings.length; line++) mappings[line] = [];
    nextMap = JSON.stringify({ ...map, mappings: encode(mappings) });
  } else if (/^\s*\/\/[#@]\s*sourceMappingURL=/mu.test(text)) {
    throw new BuildOutputFailed({ file, message: 'Generated JavaScript declares a missing source map' });
  }
  let rewritten = text;
  for (const edit of edits.reverse()) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  writeFileSync(file, rewritten);
  if (nextMap !== undefined) writeFileSync(mapPath, nextMap);
}

const narrowGeneratedImports = Effect.fn('build.narrowGeneratedImports')(function*() {
  yield* Effect.try({ try: () => {
    const api = new API({ runExternalCode: false });
    try {
      const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
          const file = join(directory, entry.name);
          if (entry.isDirectory()) visit(file);
          else if (entry.isFile() && /\.(?:[cm]?js)$/u.test(entry.name)) narrowNamespaceImports(api, file);
        }
      };
      visit('dist');
    } finally { api.close(); }
  }, catch: cause => cause instanceof BuildOutputFailed ? cause : new BuildOutputFailed({ file: 'dist', message: cause instanceof Error ? cause.message : String(cause) }) });
});

const prepare = Effect.gen(function*() {
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
    const exitCode = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project, '--noEmitOnError'], { stdout: 'inherit', stderr: 'inherit' }));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  }
  yield* narrowGeneratedImports();
});

const finish = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.tryPromise(async () => {
    const { build } = await import('vite-plus');
    await build({ configFile: 'vite.preview.config.ts' });
  });
  yield* Effect.tryPromise(() => bundle({ entryPoints: ['web/p5/runtime.ts'], outfile: 'dist/web/p5-runtime.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'linked', define: { IS_MINIFIED: 'true' } }));
  yield* fs.copyFile('node_modules/p5/license.txt', 'dist/web/P5-LICENSE.txt');
  yield* fs.copy('node_modules/p5/types', 'dist/p5-types');
  yield* fs.makeDirectory('dist/web/p5-libraries', { recursive: true });
  for (const library of Object.values(P5_LIBRARIES)) {
    yield* fs.copyFile(library.source, `dist/web/p5-libraries/${library.file}`);
    yield* fs.copyFile(library.license, `dist/web/p5-libraries/${library.file}.LICENSE`);
  }
  yield* fs.copyFile('node_modules/@fontsource-variable/noto-sans-sc/LICENSE', 'dist/web/FONT-LICENSE.txt');
  const fontLicense = yield* fs.readFileString('node_modules/@fontsource-variable/noto-sans-sc/LICENSE');
  yield* fs.writeFileString('dist/preview/FONT-LICENSE.html', `<!doctype html><meta charset="utf-8"><title>Font license</title><pre>${fontLicense.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`);
  yield* fs.remove('dist/repository/host-types', { recursive: true, force: true });
  yield* fs.copy('repository/host-types', 'dist/repository/host-types');
  yield* fs.chmod('dist/entry.js', 0o755);
  yield* fs.chmod('dist/cli.js', 0o755);
});

export const prepareDistribution = () => Effect.runPromise(prepare.pipe(Effect.provide(NodeServices.layer)));
export const finishDistribution = () => Effect.runPromise(finish.pipe(Effect.provide(NodeServices.layer)));
