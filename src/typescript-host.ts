// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
// @concord-implements docs/feature/web-workbench/architecture.md#p5-图解
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { FileSystemCallbacks } from 'typescript/fs';
import type { SourceFile } from 'typescript/ast';
import type { API, Diagnostic } from 'typescript/sync';
import { ConcordError } from './shared.js';

const require = createRequire(import.meta.url);
let packageVersion: string | undefined;
let activeAPI: API | undefined;
let trustedLibraries: ReadonlyMap<string, string> | undefined;

/** Load the native client namespace only when a compiler operation needs it. */
export function nativeTypeScript(): typeof import('typescript/sync') {
  return require('typescript/sync') as typeof import('typescript/sync');
}

/** Capture only library declarations from the matching installed platform package. */
export function typescriptLibraries(): ReadonlyMap<string, string> {
  if (trustedLibraries !== undefined) return trustedLibraries;
  return typescriptRequest(() => {
    const compilerRequire = createRequire(require.resolve('typescript/package.json'));
    const metadata = compilerRequire.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`);
    const root = join(dirname(metadata), 'lib');
    trustedLibraries = new Map(readdirSync(root).filter(name => /^lib(?:\.[a-z0-9.-]+)?\.d\.ts$/u.test(name))
      .map(name => [join(root, name).replaceAll('\\', '/'), readFileSync(join(root, name), 'utf8')]));
    return trustedLibraries;
  });
}

/** Package metadata only; a cache hit never starts the compiler. */
export function typescriptPackageVersion(): string {
  if (packageVersion !== undefined) return packageVersion;
  const parsed = JSON.parse(readFileSync(require.resolve('typescript/package.json'), 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) throw new ConcordError('TypeScriptUnavailable', 'TypeScript package version is unavailable');
  packageVersion = parsed.version;
  return packageVersion;
}

function rooted(path: string, cwd: string): string { return resolve(cwd, path).replaceAll('\\', '/'); }

/** Total, captured filesystem. There is no operating-system fallback. */
function capturedFileSystem(input: ReadonlyMap<string, string>, cwd: string): FileSystemCallbacks {
  const { serverFS } = require('typescript/fs') as typeof import('typescript/fs');
  const files = new Map([...input].map(([path, source]) => [rooted(path, cwd), source]));
  const directories = new Map<string, { files: Set<string>; directories: Set<string> }>();
  const entry = (path: string) => {
    let value = directories.get(path);
    if (value === undefined) { value = { files: new Set(), directories: new Set() }; directories.set(path, value); }
    return value;
  };
  for (const path of files.keys()) {
    const parts = path.split('/');
    const name = parts.pop()!;
    entry(parts.join('/') || '/').files.add(name);
    while (parts.length > 1) {
      const directory = parts.pop()!;
      entry(parts.join('/') || '/').directories.add(directory);
    }
  }
  return {
    readFile: path => files.get(path),
    fileExists: path => files.has(path),
    directoryExists: path => directories.has(path.replace(/\/$/u, '') || '/'),
    getAccessibleEntries: path => {
      const found = directories.get(path.replace(/\/$/u, '') || '/');
      return { files: [...(found?.files ?? [])].sort(), directories: [...(found?.directories ?? [])].sort(), symlinks: undefined };
    },
    realpath: serverFS.identity,
    stat: serverFS.fakeStat,
    writeFile: serverFS.error,
    removeFile: serverFS.error,
  };
}

/** Wrap compiler transport failures, without relabelling errors from domain callbacks. */
export function typescriptRequest<T>(run: () => T): T {
  try { return run(); }
  catch (cause) {
    if (cause instanceof ConcordError) throw cause;
    throw new ConcordError('TypeScriptUnavailable', `TypeScript compiler failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function synchronous<T>(run: () => T): T {
  const result = run();
  if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
    throw new ConcordError('TypeScriptScopeViolation', 'TypeScript scopes must return synchronously');
  }
  return result;
}

function createCompiler(files: ReadonlyMap<string, string>, cwd: string): API {
  return typescriptRequest(() => {
    const { API: CompilerAPI } = nativeTypeScript();
    return new CompilerAPI({ cwd, useCaseSensitiveFileNames: true, runExternalCode: false, fs: capturedFileSystem(files, cwd) });
  });
}

/** Own a distinct compiler with exactly these captured inputs. No handles may escape. */
export function withTypeScriptFiles<T>(files: ReadonlyMap<string, string>, run: (api: API) => T, cwd = '/'): T {
  const api = createCompiler(files, cwd);
  const previous = activeAPI;
  activeAPI = api;
  try { return synchronous(() => run(api)); }
  finally {
    activeAPI = previous;
    typescriptRequest(() => api.close());
  }
}

/** Reuse only within a synchronous lexical call stack; never across await. */
export function withTypeScript<T>(run: (api: API) => T): T {
  if (activeAPI !== undefined) return synchronous(() => run(activeAPI!));
  let loaded: API | undefined;
  const api = new Proxy({} as API, {
    get(_target, property) {
      loaded ??= createCompiler(new Map(), '/');
      const value: unknown = Reflect.get(loaded, property, loaded);
      return typeof value === 'function' ? value.bind(loaded) : value;
    },
  });
  activeAPI = api;
  try { return synchronous(() => run(api)); }
  finally {
    activeAPI = undefined;
    const owned = loaded;
    if (owned !== undefined) typescriptRequest(() => owned.close());
  }
}

/** Obtain real syntax diagnostics and an AST from a closed one-file input set. */
export function withTypeScriptSource<T>(path: string, text: string, run: (source: SourceFile, diagnostics: readonly Diagnostic[]) => T): T {
  return withTypeScript(api => {
    const { createFileSystem } = require('typescript/fs') as typeof import('typescript/fs');
    const file = rooted(path, '/');
    const snapshot = typescriptRequest(() => api.createSnapshot({
      fileSystem: createFileSystem([[file, text]]),
      createPrograms: [{ rootFiles: [file], compilerOptions: { noLib: true, noResolve: true, allowJs: true, allowNonTsExtensions: true, jsx: nativeTypeScript().JsxEmit.Preserve } }],
    }));
    try {
      const program = snapshot.operation.createdPrograms[0];
      const source = typescriptRequest(() => program.getSourceFile(file));
      if (source === undefined) throw new ConcordError('TypeScriptUnavailable', `TypeScript did not parse ${path}`);
      const diagnostics = typescriptRequest(() => program.getSyntacticDiagnostics(file));
      return synchronous(() => run(source, diagnostics));
    } finally { typescriptRequest(() => snapshot.dispose()); }
  });
}
