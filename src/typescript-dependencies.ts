// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript/ast';
import { createFileSystem } from 'typescript/fs';
import type { API, RawCompilerOptions } from 'typescript/sync';
import { nativeTypeScript, typescriptPackageVersion, typescriptRequest, withTypeScriptFiles } from './typescript-host.js';
import { ConcordError, type AnnotatedCase, type Repository } from './shared.js';
import type { CodeDeclaration } from './code.js';
import type { AnalysisValue, DependencyObservation } from './analysis-values.js';
import { analysisBudgets } from './language-server-config.js';

export const JS_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
export function withinRoots(path: string, roots: readonly string[]): boolean { return roots.some(root => path === root || path.startsWith(`${root}/`)); }

/** Resolves only the captured source set. Module resolution cannot read an ignored SDK or run a project plugin. */
export function typescriptDependencies(repo: Repository, files: ReadonlyMap<string, string>, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[]): AnalysisValue {
  const captured = new Map([...files].map(([path, text]) => [resolve(repo.root, path), text]));
  return withTypeScriptFiles(captured, api => typescriptRequest(() => analyzeCapturedDependencies(repo, files, cases, codes, captured, api)), repo.root);
}

function analyzeCapturedDependencies(repo: Repository, files: ReadonlyMap<string, string>, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[], captured: ReadonlyMap<string, string>, api: API): AnalysisValue {
  const { JsxEmit, ModuleKind, ModuleResolutionKind } = nativeTypeScript();
  const limits = analysisBudgets();
  const pathOf = (path: string) => relative(repo.root, isAbsolute(path) ? path : resolve(repo.root, path)).split(sep).join('/');
  const configPath = files.has('tsconfig.json') ? 'tsconfig.json' : files.has('jsconfig.json') ? 'jsconfig.json' : undefined;
  let options: RawCompilerOptions = { allowJs: true, module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext };
  const configurationGaps = new Set<string>();
  if (configPath !== undefined) {
    const read = api.readConfigFile(resolve(repo.root, configPath));
    if (read.error !== undefined) configurationGaps.add('UnresolvedModuleConfiguration');
    else {
      const config = api.parseConfigFile(resolve(repo.root, configPath));
      options = { ...options, ...config.options };
      if (config.errors.some(error => error.code !== 18003)) configurationGaps.add('UnresolvedModuleConfiguration');
    }
  }
  using resolver = api.createModuleResolver(options);
  using snapshot = api.createSnapshot({
    fileSystem: createFileSystem([...captured]),
    createPrograms: [{
      rootFiles: [...captured.keys()].filter(path => JS_SOURCE.test(path)),
      // Parse every captured JS/TS input independently of project inclusion and
      // module discovery; the resolver below owns dependency traversal and options.
      compilerOptions: { noLib: true, noResolve: true, allowJs: true, allowNonTsExtensions: true, jsx: JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
    }],
  });
  const program = snapshot.operation.createdPrograms[0];
  const roots = [...(repo.config.sourceRoots ?? []), ...repo.config.testRoots];
  const parsed = new Map<string, { imports: readonly string[]; gaps: readonly string[] }>();
  const imports = (path: string) => {
    const known = parsed.get(path); if (known !== undefined) return known;
    const absolute = resolve(repo.root, path);
    const source = program.getSourceFile(absolute);
    if (source === undefined) throw new ConcordError('TypeScriptUnavailable', `TypeScript did not parse captured input ${path}`);
    const names = new Set<string>(), gaps = new Set<string>();
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) names.add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) gaps.add('DynamicImport');
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') gaps.add('UnresolvedImport');
        if (ts.isIdentifier(node.expression) && ['fetch', 'WebSocket', 'XMLHttpRequest'].includes(node.expression.text)) gaps.add('NetworkBoundary');
      }
      node.forEachChild(visit);
    };
    visit(source);
    if (program.getSyntacticDiagnostics(absolute).length > 0) gaps.add('UnresolvedImport');
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
        const resolved = resolver.resolveModuleName(name, dirname(repo.absolute(current.path)), undefined, { snapshot }).resolvedModule;
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
