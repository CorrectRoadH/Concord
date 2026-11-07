import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join, resolve } from 'node:path';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { packJavaScript, p5RuntimeNotice } from './pack-javascript.ts';
import { buildStartup, bindStartupPackage } from './startup-build.ts';
import { P5_LIBRARIES } from "../src/model/p5/index.ts";
import { captureBuildSource, writeBuildIdentity } from './build-identity.ts';
import { assembleArchive } from './archive.ts';
import { archivePartInput, cachedArchivePart } from './application-cache.ts';
import { externalBuildOutput } from './build-output.ts';
import { archiveTarget } from './archive-support.ts';
import { sourceWebDigest } from '../src/base/installation/index.ts';
import { modManifest } from '../src/model/herdr-mod/index.ts';

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
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(outputRoot, { recursive: true, force: true });
  yield* fs.makeDirectory(outputRoot, { recursive: true });
  yield* fs.remove(join(outputRoot, 'node_modules'), { recursive: true, force: true });
  yield* fs.symlink(resolve('node_modules'), join(outputRoot, 'node_modules'));
  yield* fs.remove(dist(), { recursive: true, force: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) yield* fs.copy(name, join(outputRoot, name), { overwrite: true });
  yield* Effect.all(['tsconfig.json'].map(project => Effect.gen(function*() {
    const exitCode = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project, '--noEmitOnError', ...(project === 'tsconfig.json' ? ['--noEmit', 'false', '--outDir', dist()] : [])], { stdout: 'inherit', stderr: 'inherit' }));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  })), { concurrency: 'unbounded' });
  yield* narrowGeneratedImports();
  yield* buildStartup(dist(), outputRoot);
  yield* packJavaScript({ entry: { main: 'src/entry/herdr-mod/main.ts' }, outDir: dist('herdr-mod'), format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
    deps: { neverBundle: ['gpui-kit', 'gpui-base', 'herdr'], alwaysBundle: /^(?!gpui-kit$|gpui-base$|herdr$)/u, onlyBundle: false },
    outputOptions: { entryFileNames: '[name].js', comments: { legal: true } } });
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
});

const copyPart = Effect.fn('build.copyPart')(function*(part: string, output: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const name of yield* fs.readDirectory(part)) {
    if (name !== '.application-cache.json') yield* fs.copy(join(part, name), join(output, name), { overwrite: true });
  }
});

/** Build parts by their own inputs, then bind identity only in the private copy. */
export const buildApplication = (output: string): Promise<void> => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const repository = resolve(import.meta.dirname, '..');
  const destination = yield* externalBuildOutput(output);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const webCheck = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.web.json', '--noEmit'], { stdout: 'inherit', stderr: 'inherit' }));
  if (webCheck !== 0) return yield* new BuildFailed({ project: 'tsconfig.web.json', exitCode: Number(webCheck) });
  const tooling = ['scripts/distribution.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts', 'scripts/pack-javascript.ts',
    'scripts/startup-build.ts', 'scripts/build-identity.ts', 'scripts/build-output.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'tsconfig.json', 'tsconfig.web.json', 'node_modules/typescript/package.json', 'node_modules/esbuild/package.json', 'node_modules/vite-plus/package.json'];
  const codeInput = () => archivePartInput(repository, ['src', ...tooling]);
  const codeDigest = yield* codeInput();
  const code = yield* cachedArchivePart('application', codeDigest, directory => Effect.gen(function*() {
    outputRoot = directory;
    yield* prepare;
    yield* fs.chmod(dist('entry/cli/entry.js'), 0o755);
    yield* fs.chmod(dist('entry/cli/cli.js'), 0o755);
    yield* fs.remove(join(directory, 'node_modules'));
  }), codeInput);
  const resourcePaths = ['docs', 'skills', 'templates', ...(yield* fs.readDirectory(repository)).filter(name => /^README(?:\..+)?\.md$/u.test(name))];
  const resourceInput = () => archivePartInput(repository, [...resourcePaths, 'scripts/distribution.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts']);
  const resourceDigest = yield* resourceInput();
  const resources = yield* cachedArchivePart('resources', resourceDigest, directory => Effect.gen(function*() {
    yield* fs.makeDirectory(directory, { recursive: true });
    for (const name of resourcePaths) yield* fs.copy(join(repository, name), join(directory, name));
  }), resourceInput);
  const webInput = () => Effect.gen(function*() {
    return yield* archivePartInput(repository, [...tooling, 'src/model/p5'], yield* sourceWebDigest(repository));
  });
  const webDigest = yield* webInput();
  const web = yield* cachedArchivePart('web', webDigest, directory => Effect.gen(function*() {
    outputRoot = directory;
    yield* fs.makeDirectory(dist(), { recursive: true });
    yield* Effect.tryPromise(async () => {
      const { build } = await import('vite-plus');
      await build({ configFile: 'vite.source.config.ts', build: { outDir: dist('web'), write: true, minify: true, license: true, emptyOutDir: true } });
    });
    yield* finish;
  }), webInput);
  yield* fs.remove(destination, { recursive: true, force: true });
  yield* fs.makeDirectory(destination, { recursive: true });
  for (const part of [code, resources, web]) yield* copyPart(part, destination);
  const identity = yield* captureBuildSource();
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(yield* fs.readFileString(join(destination, 'package.json')));
  yield* fs.writeFileString(join(destination, 'package.json'), `${JSON.stringify({ ...manifest, gitHead: identity.commit })}\n`);
  const version = yield* Schema.decodeUnknownEffect(Schema.String)(manifest.version);
  yield* fs.writeFileString(join(destination, 'dist/herdr-mod/mod.json'), `${JSON.stringify(modManifest(version))}\n`);
  yield* writeBuildIdentity(identity, join(destination, 'dist'));
  yield* bindStartupPackage(join(destination, 'dist'), destination);
  if ((yield* codeInput()) !== codeDigest || (yield* resourceInput()) !== resourceDigest || (yield* webInput()) !== webDigest) return yield* new BuildOutputFailed({ file: destination, message: 'Application inputs changed while assembling parts' });
})).pipe(Effect.provide(NodeServices.layer)));

export const buildDistribution = async (output: string): Promise<void> => {
  const target = archiveTarget();
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-application-' });
    const applicationRoot = join(temporary, 'app');
    yield* Effect.tryPromise({ try: () => buildApplication(applicationRoot), catch: cause => cause });
    yield* assembleArchive({ target, applicationRoot, outputRoot: output });
  })).pipe(Effect.provide(NodeServices.layer)));
};
