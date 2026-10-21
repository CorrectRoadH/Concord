// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type * as TypeScript from 'typescript';
import { loadTypeScript, typescriptPackageVersion } from './typescript-host.js';
import type { AnnotatedCase, Repository } from './shared.js';
import type { CodeDeclaration } from './code.js';
import type { AnalysisValue, DependencyObservation } from './analysis-values.js';
import { analysisBudgets } from './language-server-config.js';

export const JS_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
export function withinRoots(path: string, roots: readonly string[]): boolean { return roots.some(root => path === root || path.startsWith(`${root}/`)); }

/** Resolves only the captured source set. Module resolution cannot read an ignored SDK or run a project plugin. */
export function typescriptDependencies(repo: Repository, files: ReadonlyMap<string, string>, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[]): AnalysisValue {
  const ts = loadTypeScript();
  const limits = analysisBudgets();
  const pathOf = (path: string) => relative(repo.root, isAbsolute(path) ? path : resolve(repo.root, path)).split(sep).join('/');
  const host: TypeScript.ModuleResolutionHost = {
    fileExists: path => files.has(pathOf(path)), readFile: path => files.get(pathOf(path)),
    directoryExists: path => pathOf(path) === '' || [...files.keys()].some(file => file.startsWith(`${pathOf(path)}/`)),
    getCurrentDirectory: () => repo.root, realpath: path => path,
  };
  const configPath = files.has('tsconfig.json') ? 'tsconfig.json' : files.has('jsconfig.json') ? 'jsconfig.json' : undefined;
  let options: TypeScript.CompilerOptions = { allowJs: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const configurationGaps = new Set<string>();
  if (configPath !== undefined) {
    const read = ts.readConfigFile(configPath, path => files.get(pathOf(path)));
    if (read.error !== undefined) configurationGaps.add('UnresolvedModuleConfiguration');
    else {
      const config = ts.parseJsonConfigFileContent(read.config, { useCaseSensitiveFileNames: true, fileExists: host.fileExists, readFile: host.readFile, readDirectory: () => [] }, repo.root);
      options = { ...options, ...config.options };
      if (config.errors.some(error => error.code !== 18003)) configurationGaps.add('UnresolvedModuleConfiguration');
    }
  }
  const roots = [...(repo.config.sourceRoots ?? []), ...repo.config.testRoots];
  const parsed = new Map<string, { imports: readonly string[]; gaps: readonly string[] }>();
  const imports = (path: string) => {
    const known = parsed.get(path); if (known !== undefined) return known;
    const text = files.get(path)!;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const names = new Set<string>(), gaps = new Set<string>();
    const visit = (node: TypeScript.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) names.add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) gaps.add('DynamicImport');
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') gaps.add('UnresolvedImport');
        if (ts.isIdentifier(node.expression) && ['fetch', 'WebSocket', 'XMLHttpRequest'].includes(node.expression.text)) gaps.add('NetworkBoundary');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const parseErrors = (source as TypeScript.SourceFile & { readonly parseDiagnostics?: readonly TypeScript.Diagnostic[] }).parseDiagnostics;
    if (parseErrors?.length) gaps.add('UnresolvedImport');
    for (const name of names) {
      if (/^(?:node:)?child_process$/u.test(name)) gaps.add('SubprocessBoundary');
      if (/^(?:node:)?(?:https?|net|tls)$/u.test(name)) gaps.add('NetworkBoundary');
    }
    const value = { imports: [...names], gaps: [...gaps] }; parsed.set(path, value); return value;
  };
  const dependencies: DependencyObservation[] = cases.filter(item => JS_SOURCE.test(item.file)).map(item => {
    const gaps = new Set(['FileScope', 'OpenWorldCalls', ...configurationGaps]);
    const edges: { from: string; to: string }[] = [], declarations = new Set<string>(), visited = new Set<string>();
    const queue = [{ path: item.file, depth: 0 }];
    let sourceImports = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.path)) continue;
      if (visited.size >= limits.nodes) { gaps.add('NodeLimit'); break; }
      visited.add(current.path);
      if (!files.has(current.path)) { gaps.add('UnresolvedImport'); continue; }
      for (const code of codes) if (code.file === current.path && withinRoots(code.file, repo.config.sourceRoots ?? [])) declarations.add(code.id);
      const found = imports(current.path); for (const gap of found.gaps) gaps.add(gap);
      for (const name of found.imports) {
        const resolved = ts.resolveModuleName(name, repo.absolute(current.path), options, host).resolvedModule;
        if (resolved === undefined) { gaps.add('UnresolvedImport'); continue; }
        const target = pathOf(resolved.resolvedFileName);
        if (!withinRoots(target, roots) || !JS_SOURCE.test(target) || !files.has(target)) { gaps.add('ExternalTarget'); continue; }
        if (withinRoots(target, repo.config.sourceRoots ?? [])) sourceImports++;
        edges.push({ from: current.path, to: target });
        if (current.depth >= limits.depth) { gaps.add('DepthLimit'); continue; }
        queue.push({ path: target, depth: current.depth + 1 });
      }
    }
    if (sourceImports === 0) gaps.add('NoSourceImports');
    return { testId: item.id, scope: 'file', file: item.file, declarations: [...declarations].sort(), edges, gaps: [...gaps].sort() };
  });
  return { analyzer: 'typescript', profile: `typescript/${typescriptPackageVersion()}/dependency-v1`, encoding: 'utf-16', locators: [], dependencies, gaps: [...new Set(dependencies.flatMap(item => item.gaps))] };
}
