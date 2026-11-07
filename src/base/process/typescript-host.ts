// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
// @concord-implements docs/feature/web-workbench/architecture.md#p5-图解
import type * as AsyncTypes from 'typescript/async';
import { AsyncLocalStorage } from 'node:async_hooks';
import type * as FsTypes from 'typescript/fs';
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { FileSystemCallbacks } from "typescript/fs";
import type { SourceFile } from "typescript/ast";
import type { API, Diagnostic } from "typescript/async";
import { packageRoot } from "../installation/index.ts";
import { compilerSupervisorPath } from './typescript-supervisor-build.ts';
import { ConcordError } from "../../model/index.ts";

const require = createRequire(join(packageRoot, 'package.json'));
let packageVersion: string | undefined;
interface CompilerScope { readonly api: API; closed: boolean }
const compilerScopes = new AsyncLocalStorage<CompilerScope>();
let trustedLibraries: ReadonlyMap<string, string> | undefined;

/** Load the native client namespace only when a compiler operation needs it. */
export function nativeTypeScript(): typeof AsyncTypes {
  return require('typescript/async') as typeof AsyncTypes;
}

/** Capture only library declarations from the matching installed platform package. */
export function typescriptLibraries(): ReadonlyMap<string, string> {
  if (trustedLibraries !== undefined) return trustedLibraries;
  return syncRequest(() => {
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
  const { serverFS } = require('typescript/fs') as typeof FsTypes;
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

/** Wrap only transport calls, never the domain callback. */
function syncRequest<T>(run: () => T): T {
  try { return run(); }
  catch (cause) { throw compilerFailure(cause); }
}
function compilerFailure(cause: unknown): ConcordError {
  return cause instanceof ConcordError ? cause : new ConcordError('TypeScriptUnavailable', `TypeScript compiler failed: ${cause instanceof Error ? cause.message : String(cause)}`);
}
export async function typescriptRequest<T>(run: () => T | Promise<T>): Promise<T> {
  try { return await run(); }
  catch (cause) { throw compilerFailure(cause); }
}

/** Attempt cleanup without replacing the domain failure's named identity. */
async function owned<T>(run: () => T | Promise<T>, release: () => void | Promise<void>): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; cause: unknown };
  try { outcome = { ok: true, value: await run() }; }
  catch (cause) { outcome = { ok: false, cause }; }
  try { await release(); }
  catch (cleanup) {
    if (outcome.ok) throw compilerFailure(cleanup);
    const primary = outcome.cause;
    const detail = cleanup instanceof Error ? cleanup.message : String(cleanup);
    if (primary instanceof ConcordError) throw new ConcordError(primary.code, primary.message, { primary: primary.details, cleanup: detail });
    throw new AggregateError([primary, cleanup], 'TypeScript operation and cleanup failed', { cause: primary });
  }
  if (!outcome.ok) throw outcome.cause;
  return outcome.value;
}

export function withTypeScriptResource<R extends { dispose(): void | Promise<void> }, T>(resource: R, run: (resource: R) => T | Promise<T>): Promise<T> {
  return owned(() => run(resource), () => typescriptRequest(() => resource.dispose()));
}

function scopeFor(files: ReadonlyMap<string, string>, cwd: string): CompilerScope & { close(): Promise<void> } {
  let loaded: API | undefined;
  const scope: CompilerScope & { close(): Promise<void> } = {
    closed: false,
    api: new Proxy({} as API, {
      get(_target, property) {
        const current = () => {
          if (scope.closed) throw new ConcordError('TypeScriptScopeViolation', 'TypeScript scope is closed');
          loaded ??= syncRequest(() => new (nativeTypeScript().API)({ tsserverPath: compilerSupervisorPath(), cwd, useCaseSensitiveFileNames: true, runExternalCode: false, fs: capturedFileSystem(files, cwd) }));
          return loaded;
        };
        const api = current();
        const value: unknown = Reflect.get(api, property, api);
        return typeof value === 'function' ? (...args: unknown[]) => Reflect.apply(value, current(), args) : value;
      },
    }),
    close: async () => {
      scope.closed = true;
      if (loaded !== undefined) await typescriptRequest(() => loaded!.close());
    },
  };
  return scope;
}

/** Own an independent captured compiler scope through the complete callback. */
export async function withTypeScriptFiles<T>(files: ReadonlyMap<string, string>, run: (api: API) => T | Promise<T>, cwd = '/'): Promise<T> {
  const scope = scopeFor(files, cwd);
  return compilerScopes.run(scope, () => owned(() => run(scope.api), () => scope.close()));
}

/** Nested operations share only their asynchronous call chain's live scope. */
export async function withTypeScript<T>(run: (api: API) => T | Promise<T>): Promise<T> {
  const scope = compilerScopes.getStore();
  if (scope !== undefined) {
    if (scope.closed) throw new ConcordError('TypeScriptScopeViolation', 'TypeScript scope is closed');
    return run(scope.api);
  }
  return withTypeScriptFiles(new Map(), run);
}

/** Project the real AST and diagnostics before releasing the snapshot. */
export async function withTypeScriptSource<T>(path: string, text: string, run: (source: SourceFile, diagnostics: readonly Diagnostic[]) => T | Promise<T>): Promise<T> {
  return withTypeScript(async api => {
    const { createFileSystem } = require('typescript/fs') as typeof FsTypes;
    const file = rooted(path, '/');
    const snapshot = await typescriptRequest(() => api.createSnapshot({
      fileSystem: createFileSystem([[file, text]]),
      createPrograms: [{ rootFiles: [file], compilerOptions: { noLib: true, noResolve: true, allowJs: true, allowNonTsExtensions: true, jsx: nativeTypeScript().JsxEmit.Preserve } }],
    }));
    return withTypeScriptResource(snapshot, async () => {
      const program = snapshot.operation.createdPrograms[0];
      const source = await typescriptRequest(() => program.getSourceFile(file));
      if (source === undefined) throw new ConcordError('TypeScriptUnavailable', `TypeScript did not parse ${path}`);
      const diagnostics = await typescriptRequest(() => program.getSyntacticDiagnostics(file));
      return run(source, diagnostics);
    });
  });
}
