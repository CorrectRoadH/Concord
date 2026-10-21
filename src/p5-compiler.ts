// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/embed-p5-sketch.md
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, posix, resolve } from 'node:path';
import { Effect } from 'effect';
import { build, type Loader } from 'esbuild';
import * as ts from 'typescript/ast';
import type { RawCompilerOptions } from 'typescript/sync';
import { createFileSystem } from 'typescript/fs';
import { nativeTypeScript, typescriptLibraries, typescriptRequest, withTypeScript, withTypeScriptFiles, withTypeScriptSource } from './typescript-host.js';
import { LocalRepository } from './storage.js';
import { getViewFile } from './application.js';
import { ConcordError, decode, failure } from './shared.js';
import { P5_LIBRARIES, P5RequestSchema, parseP5Options, type P5Bundle } from './p5-contract.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 128;
const loaders: Readonly<Record<string, Loader>> = {
  '.ts': 'ts', '.js': 'js', '.mjs': 'js', '.css': 'css', '.json': 'json',
  '.txt': 'text', '.vert': 'text', '.frag': 'text', '.glsl': 'text',
  '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl',
  '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.otf': 'dataurl',
  '.mp3': 'dataurl', '.wav': 'dataurl', '.ogg': 'dataurl', '.mp4': 'dataurl', '.webm': 'dataurl',
  '.obj': 'text', '.stl': 'dataurl',
};
const hooks = ['setup', 'draw', 'mouseMoved', 'mouseDragged', 'mousePressed', 'mouseReleased', 'mouseClicked', 'doubleClicked', 'mouseWheel', 'keyPressed', 'keyReleased', 'keyTyped', 'touchStarted', 'touchMoved', 'touchEnded', 'windowResized', 'deviceMoved', 'deviceTurned', 'deviceShaken'];

function sketchSource(source: string, mode: 'instance' | 'global', inline: boolean): string {
  return withTypeScriptSource('sketch.ts', source, ast => {
  if (mode === 'global') {
    const declared = hooks.filter(name => ast.statements.some(statement =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name ||
      ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name)));
    return `${source}\nObject.assign(window, {${declared.join(',')}});\nexport {};`;
  }
  if (!inline || ast.statements.some(statement => ts.isExportAssignment(statement) || 'modifierFlags' in statement && typeof statement.modifierFlags === 'number' && (statement.modifierFlags & ts.ModifierFlags.Default) !== 0)) return source;
  const imports = ast.statements.filter(ts.isImportDeclaration);
  let body = source;
  for (const statement of [...imports].reverse()) body = body.slice(0, statement.pos) + '\n'.repeat(source.slice(statement.pos, statement.end).split('\n').length - 1) + body.slice(statement.end);
  return `${imports.map(statement => statement.getText(ast)).join('\n')}\nexport default function(p: import('p5').default) {\n${body}\n}`;
  });
}

/** Type checking reads only the captured graph and trusted compiler/p5 declarations. */
function checkTypes(sources: Map<string, string>, resolutions: Map<string, string>, global: boolean, captureType: (specifier: string, importer: string) => { path: string; source: string }): void {
  const { DiagnosticCategory, ModuleKind, ModuleResolutionKind } = nativeTypeScript();
  const p5Types = fileURLToPath(new URL('./p5-types/p5.d.ts', import.meta.url)).replaceAll('\\', '/');
  const globalTypes = join(dirname(p5Types), 'global.d.ts').replaceAll('\\', '/');
  // Freeze the full type closure before handing a total filesystem to the compiler.
  withTypeScript(() => {
    const visited = new Set<string>();
    for (const [path, source] of sources) {
      if (visited.has(path) || path.endsWith('.json')) continue;
      visited.add(path);
      const names = withTypeScriptSource(path, source, ast => {
        const names = new Set<string>();
        const visit = (node: ts.Node): void => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) names.add(node.moduleSpecifier.text);
          if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) names.add(node.argument.literal.text);
          if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) names.add(node.moduleReference.expression.text);
          node.forEachChild(visit);
        };
        visit(ast);
        for (const reference of ast.referencedFiles) {
          if (reference.fileName.startsWith('/') || /^[a-z]+:/iu.test(reference.fileName)) throw new ConcordError('P5ImportUnsupported', 'Type references must be relative repository paths');
          names.add(reference.fileName.startsWith('.') ? reference.fileName : `./${reference.fileName}`);
        }
        return [...names];
      });
      for (const name of names) {
        if (name === 'p5' || !name.startsWith('./') && !name.startsWith('../')) continue;
        let target = resolutions.get(`${path}\0${name}`);
        if (target && sources.has(target)) continue;
        const captured = captureType(name, path);
        target = captured.path;
        resolutions.set(`${path}\0${name}`, target);
        if (/\.(?:ts|js|mjs|json)$/u.test(target)) sources.set(target, captured.source);
      }
    }
  });
  const ambient = '/__concord_p5_assets.d.ts';
  const virtual = new Map([...sources].map(([path, source]) => [`/${path}`, source]));
  virtual.set(ambient, Object.keys(loaders).filter(extension => !['.ts', '.js', '.mjs', '.json'].includes(extension)).map(extension => `declare module '*${extension}' { const value: string; export default value; }`).join('\n'));
  virtual.set(p5Types, readFileSync(p5Types, 'utf8'));
  if (global) virtual.set(globalTypes, readFileSync(globalTypes, 'utf8'));
  for (const [path, source] of typescriptLibraries()) virtual.set(path, source);
  const options: RawCompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, allowJs: true, checkJs: false, allowUmdGlobalAccess: true, target: ts.ScriptTarget.ES2022, module: ModuleKind.ESNext, moduleResolution: ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, resolveJsonModule: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] };
  // The API resolver receives a containing directory. Equal directory/specifier
  // pairs must resolve identically under the existing relative-file resolver.
  const fixed = new Map<string, string>();
  for (const [key, target] of resolutions) {
    const [importer, name] = key.split('\0');
    fixed.set(`${posix.dirname(`/${importer!}`)}\0${name!}`, `/${target}`);
  }
  withTypeScriptFiles(virtual, api => {
    using resolver = typescriptRequest(() => api.createModuleResolver(options, { resolveModuleName: (name, directory) => {
      if (name === 'p5' || directory === dirname(p5Types) && name === './p5.js') return { resolvedFileName: p5Types };
      const target = fixed.get(`${directory}\0${name}`);
      return target && /\.(?:ts|js|mjs|json)$/u.test(target) ? { resolvedFileName: target } : undefined;
    } }));
    using snapshot = typescriptRequest(() => api.createSnapshot({ fileSystem: createFileSystem([...virtual]), createPrograms: [{ rootFiles: [...sources.keys()].map(path => `/${path}`).concat(ambient, ...(global ? [globalTypes] : [])), compilerOptions: options, options: { moduleResolver: resolver } }] }));
    const program = snapshot.operation.createdPrograms[0];
    const errors = typescriptRequest(() => [...program.getProgramDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]).filter(d => d.category === DiagnosticCategory.Error);
    if (errors.length) throw new ConcordError('P5TypeError', errors.slice(0, 20).map(d => {
      const where = d.fileName && d.startPosition ? `${d.fileName.replace(/^\//u, '')}:${d.startPosition.line + 1}: ` : '';
      return where + d.text;
    }).join('\n'));
  });
}

export const compileP5 = Effect.fn('view.compileP5')(function*(root: string, input: unknown) {
  const request = yield* Effect.try({ try: () => decode(P5RequestSchema, input, 'p5 request'), catch: failure });
  if (Buffer.byteLength(request.code) > 256 * 1024) return yield* Effect.fail(new ConcordError('P5BudgetExceeded', 'Inline sketch exceeds 256 KiB'));
  const document = yield* getViewFile(root, request.document);
  if (!/\.md$/iu.test(document.path)) return yield* Effect.fail(new ConcordError('P5DocumentRequired', 'p5 sketches must belong to a readable Markdown document'));
  const options = yield* Effect.try({ try: () => parseP5Options(request.meta), catch: cause => new ConcordError('P5MetadataInvalid', String(cause)) });
  if (options.src && request.code.trim()) return yield* Effect.fail(new ConcordError('P5AmbiguousSource', 'A p5 block must use either src or inline code, not both'));
  const repo = yield* Effect.acquireRelease(Effect.try({ try: () => new LocalRepository(root, { access: 'read' }), catch: failure }), repo => Effect.sync(() => repo.close()));
  const observed = new Map<string, Buffer | undefined>();
  const sources = new Map<string, string>();
  const resolutions = new Map<string, string>();
  let bytes = Buffer.byteLength(request.code);
  const read = (path: string): Buffer | undefined => {
    if (path.split('/').some(part => part.startsWith('.') || part === 'node_modules') || !loaders[extname(path)]) throw new ConcordError('P5UnsafePath', `Unsupported sketch path: ${path}`);
    if (observed.has(path)) return observed.get(path);
    if (observed.size >= MAX_FILES) throw new ConcordError('P5BudgetExceeded', `A sketch may reference at most ${MAX_FILES} files`);
    const value = repo.snapshot(() => {
      const absolute = repo.absolute(path);
      const stat = lstatSync(absolute, { throwIfNoEntry: false });
      if (!stat) return undefined;
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new ConcordError('P5BudgetExceeded', 'Sketch inputs must be bounded regular files');
      return readFileSync(absolute);
    });
    bytes += value?.byteLength ?? 0;
    if (bytes > MAX_BYTES) throw new ConcordError('P5BudgetExceeded', 'Sketch inputs exceed 8 MiB');
    observed.set(path, value);
    return value;
  };
  const resolveImport = (specifier: string, importer: string): string => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../') || /[\\?#\0]/u.test(specifier)) throw new ConcordError('P5ImportUnsupported', `Use relative repository imports or the bundled p5 library: ${specifier}`);
    const target = posix.normalize(posix.join(posix.dirname(importer), specifier));
    const candidates = extname(target) ? [target, ...(target.endsWith('.js') ? [target.slice(0, -3) + '.ts', target.slice(0, -3) + '.d.ts'] : [])] : [target + '.ts', target + '.js', target + '.d.ts', target + '/index.ts', target + '/index.js', target + '/index.d.ts'];
    for (const candidate of candidates) if (read(candidate) !== undefined) {
      resolutions.set(`${importer}\0${specifier}`, candidate);
      return candidate;
    }
    throw new ConcordError('P5FileNotFound', `Sketch dependency not found: ${specifier}`);
  };
  const mode = options.mode ?? 'instance';
  const entry = yield* Effect.try({ try: () => options.src ? resolveImport(options.src, document.path) : posix.join(posix.dirname(document.path), '__inline_p5__.ts'), catch: failure });
  if (!/\.(ts|js|mjs)$/u.test(entry)) return yield* Effect.fail(new ConcordError('P5EntryInvalid', 'Sketch entry must be TypeScript or JavaScript'));
  const source = yield* Effect.try({ try: () => sketchSource(options.src ? read(entry)!.toString('utf8') : request.code, mode, !options.src), catch: failure });
  const libraries = yield* Effect.try({ try: () => {
    const names = repo.config.p5?.libraries ?? [];
    return names.map(name => {
      if (Object.hasOwn(P5_LIBRARIES, name)) {
        const library = P5_LIBRARIES[name as keyof typeof P5_LIBRARIES];
        return { name: `${name}@${library.version}`, source: readFileSync(fileURLToPath(new URL(`./web/p5-libraries/${library.file}`, import.meta.url)), 'utf8') };
      }
      if (name.startsWith('./') || name.startsWith('../')) {
        const path = resolveImport(name, 'concord.config.ts');
        if (!path.endsWith('.js')) throw new ConcordError('P5LibraryInvalid', 'Classic local libraries must use .js; use module imports for TypeScript');
        return { name: path, source: read(path)!.toString('utf8') };
      }
      throw new ConcordError('P5LibraryUnknown', `Unknown bundled library: ${name}. Available: ${Object.keys(P5_LIBRARIES).join(', ')}`);
    });
  }, catch: failure });
  const cssImport = yield* Effect.try({ try: () => options.css ? './' + posix.relative(posix.dirname(entry), resolveImport(options.css, document.path)) : undefined, catch: failure });
  const entrySource = `${cssImport ? `import ${JSON.stringify(cssImport)};\n` : ''}${source}`;
  const output = yield* Effect.tryPromise({ try: () => build({
    entryPoints: [entry], bundle: true, write: false, outdir: '/concord-p5-output', format: 'iife', globalName: 'ConcordSketch', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'concord-sketch', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'p5') return { path: 'p5', namespace: 'p5-library' };
        return { path: args.kind === 'entry-point' ? entry : resolveImport(args.path, args.importer), namespace: 'sketch' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'p5-library' }, () => ({ contents: 'module.exports = window.p5;', loader: 'js' }));
      builder.onLoad({ filter: /.*/, namespace: 'sketch' }, args => {
        const contents = args.path === entry ? Buffer.from(entrySource) : read(args.path)!;
        const loader = loaders[extname(args.path)]!;
        if (['ts', 'js', 'json'].includes(loader)) sources.set(args.path, contents.toString('utf8'));
        return { contents, loader };
      });
    } }],
  }), catch: cause => new ConcordError('P5CompileFailed', cause instanceof Error ? cause.message : String(cause)) });
  yield* Effect.try({ try: () => {
    checkTypes(sources, resolutions, mode === 'global', (specifier, importer) => {
      const path = resolveImport(specifier, importer);
      return { path, source: read(path)!.toString('utf8') };
    });
    repo.snapshot(() => {
      for (const [path, before] of observed) {
        const absolute = repo.absolute(path);
        const stat = lstatSync(absolute, { throwIfNoEntry: false });
        const after = stat?.isFile() && stat.size <= MAX_BYTES ? readFileSync(absolute) : undefined;
        if (before === undefined ? stat !== undefined : after === undefined || !before.equals(after)) throw new ConcordError('P5SourceChanged', 'Sketch inputs changed during compilation; run again');
      }
    });
  }, catch: failure });
  const javascript = output.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? '';
  const css = output.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  if (Buffer.byteLength(javascript) + Buffer.byteLength(css) + libraries.reduce((size, library) => size + Buffer.byteLength(library.source), 0) > 16 * 1024 * 1024) return yield* Effect.fail(new ConcordError('P5BudgetExceeded', 'Compiled sketch exceeds 16 MiB'));
  return { javascript, css, mode, libraries, files: [...observed].filter(([, value]) => value !== undefined).map(([path]) => path) } satisfies P5Bundle;
}, Effect.scoped);
