import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join, resolve } from 'node:path';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { packJavaScript, p5RuntimeNotice } from './pack-javascript.js';
import { buildStartup } from './startup-build.js';
import { P5_LIBRARIES } from "../src/model/p5/index.js";
import { captureBuildSource, writeBuildIdentity, type BuildIdentity } from './build-identity.js';
import { modManifest } from '../src/model/herdr-mod/index.js';

let sourceIdentity: BuildIdentity | undefined;
let outputRoot: string;
const dist = (path = '') => join(outputRoot, 'dist', path);

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

function namespaceImportEdits(api: API, file: string, text: string) {
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
  return edits;
}

const narrowNamespaceImports = Effect.fn('build.narrowNamespaceImports')(function*(api: API, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(file);
  const edits = yield* Effect.try({
    try: () => namespaceImportEdits(api, file, text),
    catch: cause => cause instanceof BuildOutputFailed ? cause : new BuildOutputFailed({ file, message: String(cause) }),
  });
  if (edits.length === 0) return;
  const mapPath = `${file}.map`;
  let nextMap: string | undefined;
  if (yield* fs.exists(mapPath)) {
    const map = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SourceMapSchema), { onExcessProperty: 'error' })(yield* fs.readFileString(mapPath));
    // decode resolves all cross-line source/name deltas before any line is removed.
    const mappings = decode(map.mappings);
    for (const edit of edits) for (let line = edit.firstLine; line <= edit.lastLine && line < mappings.length; line++) mappings[line] = [];
    nextMap = JSON.stringify({ ...map, mappings: encode(mappings) });
  } else if (/^\s*\/\/[#@]\s*sourceMappingURL=/mu.test(text)) {
    return yield* new BuildOutputFailed({ file, message: 'Generated JavaScript declares a missing source map' });
  }
  let rewritten = text;
  for (const edit of edits.reverse()) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  yield* fs.writeFileString(file, rewritten);
  if (nextMap !== undefined) yield* fs.writeFileString(mapPath, nextMap);
});

const narrowGeneratedImports = Effect.fn('build.narrowGeneratedImports')(function*() {
  const fs = yield* FileSystem.FileSystem;
  const api = yield* Effect.acquireRelease(Effect.sync(() => new API({ runExternalCode: false })), api => Effect.sync(() => api.close()));
  for (const name of (yield* fs.readDirectory(dist(), { recursive: true })).sort((left, right) => left.localeCompare(right))) {
    if (!/\.(?:[cm]?js)$/u.test(name)) continue;
    const file = dist(name);
    if ((yield* fs.stat(file)).type === 'File') yield* narrowNamespaceImports(api, file);
  }
}, Effect.scoped);

const prepare = Effect.gen(function*() {
  sourceIdentity = yield* captureBuildSource();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(outputRoot, { recursive: true });
  yield* fs.remove(join(outputRoot, 'node_modules'), { recursive: true, force: true });
  yield* fs.symlink(resolve('node_modules'), join(outputRoot, 'node_modules'));
  yield* fs.remove(dist(), { recursive: true, force: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'templates', 'skills', 'docs', ...(yield* fs.readDirectory('.')).filter(name => /^README(?:\..+)?\.md$/u.test(name))]) yield* fs.copy(name, join(outputRoot, name), { overwrite: true });
  const nativeArgs = ['--import', 'tsx', 'scripts/build-native.ts', '--output', dist('native'), '--reuse'];
  const prebuilt = process.env.CONCORD_NATIVE_ARTIFACTS;
  if (prebuilt !== undefined) nativeArgs.push('--prebuilt', prebuilt);
  if (process.env.CONCORD_REQUIRE_PORTABLE_NATIVE === '1') nativeArgs.push('--require-portable');
  const nativeExit = yield* spawner.exitCode(ChildProcess.make(process.execPath, nativeArgs, { stdout: 'inherit', stderr: 'inherit' }));
  if (nativeExit !== 0) return yield* new BuildFailed({ project: 'hawdb-native', exitCode: nativeExit });
  yield* Effect.all(['tsconfig.json', 'tsconfig.web.json'].map(project => Effect.gen(function*() {
    const exitCode = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project, '--noEmitOnError', ...(project === 'tsconfig.json' ? ['--noEmit', 'false', '--outDir', dist()] : [])], { stdout: 'inherit', stderr: 'inherit' }));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  })), { concurrency: 'unbounded' });
  yield* narrowGeneratedImports();
  yield* buildStartup(dist(), outputRoot);
  yield* packJavaScript({ entry: { main: 'src/entry/herdr-mod/main.ts' }, outDir: dist('herdr-mod'), format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
    deps: { neverBundle: ['gpui-kit', 'gpui-base', 'herdr'], alwaysBundle: /^(?!gpui-kit$|gpui-base$|herdr$)/u, onlyBundle: false },
    outputOptions: { entryFileNames: '[name].js', comments: { legal: true } } });
  const modPackage = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })), { onExcessProperty: 'ignore' })(yield* fs.readFileString('package.json'));
  yield* fs.writeFileString(dist('herdr-mod/mod.json'), JSON.stringify(modManifest(modPackage.version)) + '\n');
  yield* fs.copyFile('src/entry/herdr-mod/preview.png', dist('herdr-mod/preview.png'));
  yield* fs.writeFileString(dist('herdr-mod/NOTICE.txt'), `Concord Herdr mod bundles Effect.\n\n${yield* fs.readFileString('node_modules/effect/LICENSE')}`);
});

const finish = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.tryPromise(async () => {
    const { build } = await import('vite-plus');
    await build({ configFile: 'vite.preview.config.ts', build: { outDir: dist('preview') } });
  });
  yield* packJavaScript({ entry: { 'p5-runtime': 'web/p5/runtime.ts' }, outDir: dist('web'), format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    deps: { alwaysBundle: /.*/u, onlyBundle: false }, define: { IS_MINIFIED: 'true' },
    plugins: [p5RuntimeNotice],
    outputOptions: { entryFileNames: '[name].js', comments: { legal: true } } });
  yield* fs.copyFile('node_modules/p5/license.txt', dist('web/P5-LICENSE.txt'));
  yield* fs.copy('node_modules/p5/types', dist('p5-types'));
  yield* fs.makeDirectory(dist('web/p5-libraries'), { recursive: true });
  for (const library of Object.values(P5_LIBRARIES)) {
    yield* fs.copyFile(library.source, dist(`web/p5-libraries/${library.file}`));
    yield* fs.copyFile(library.license, dist(`web/p5-libraries/${library.file}.LICENSE`));
  }
  yield* fs.copyFile('node_modules/@fontsource-variable/noto-sans-sc/LICENSE', dist('web/FONT-LICENSE.txt'));
  const fontLicense = yield* fs.readFileString('node_modules/@fontsource-variable/noto-sans-sc/LICENSE');
  yield* fs.writeFileString(dist('preview/FONT-LICENSE.html'), `<!doctype html><meta charset="utf-8"><title>Font license</title><pre>${fontLicense.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`);
  yield* fs.chmod(dist('entry/cli/entry.js'), 0o755);
  yield* fs.chmod(dist('entry/cli/cli.js'), 0o755);
});

export const prepareDistribution = (output: string) => { outputRoot = output; return Effect.runPromise(prepare.pipe(Effect.provide(NodeServices.layer))); };
export const finishDistribution = (output: string) => { outputRoot = output; return Effect.runPromise(Effect.gen(function*() {
  yield* finish;
  if (sourceIdentity !== undefined) yield* writeBuildIdentity(sourceIdentity, dist());
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(join(outputRoot, 'node_modules'));
}).pipe(Effect.provide(NodeServices.layer))); };
