// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md#验收
import { withinRoots } from "../../model/index.ts";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from 'typescript/ast';
import { createFileSystem } from "typescript/fs";
import type { API, RawCompilerOptions } from "typescript/async";
import { nativeTypeScript, typescriptPackageVersion, typescriptRequest, withTypeScriptFiles, withTypeScriptResource } from "../../base/process/index.ts";
import { ConcordError, type AnnotatedCase, type Repository } from "../../model/index.ts";
import type { CodeDeclaration } from "../../model/index.ts";
import type { AnalysisValue, DependencyObservation } from "../../model/index.ts";
import { analysisBudgets } from "../../model/index.ts";

export const JS_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;

/** Resolves only the captured source set. Module resolution cannot read an ignored SDK or run a project plugin. */
export function typescriptDependencies(repo: Repository, files: ReadonlyMap<string, string>, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[]): Promise<AnalysisValue> {
  const captured = new Map([...files].map(([path, text]) => [resolve(repo.root, path), text]));
  return withTypeScriptFiles(captured, api => typescriptRequest(() => analyzeCapturedDependencies(repo, files, cases, codes, captured, api)), repo.root);
}

async function analyzeCapturedDependencies(repo: Repository, files: ReadonlyMap<string, string>, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[], captured: ReadonlyMap<string, string>, api: API): Promise<AnalysisValue> {
  const { JsxEmit, ModuleKind, ModuleResolutionKind } = nativeTypeScript();
  const limits = analysisBudgets();
  const pathOf = (path: string) => relative(repo.root, isAbsolute(path) ? path : resolve(repo.root, path)).split(sep).join('/');
  const configPath = files.has('tsconfig.json') ? 'tsconfig.json' : files.has('jsconfig.json') ? 'jsconfig.json' : undefined;
  let options: RawCompilerOptions = { allowJs: true, module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext };
  const configurationGaps = new Set<string>();
  if (configPath !== undefined) {
    const read = await typescriptRequest(() => api.readConfigFile(resolve(repo.root, configPath)));
    if (read.error !== undefined) configurationGaps.add('UnresolvedModuleConfiguration');
    else {
      const config = await typescriptRequest(() => api.parseConfigFile(resolve(repo.root, configPath)));
      options = { ...options, ...config.options };
      if (config.errors.some(error => error.code !== 18003)) configurationGaps.add('UnresolvedModuleConfiguration');
    }
  }
  const resolver = await typescriptRequest(() => api.createModuleResolver(options));
  return withTypeScriptResource(resolver, async () => {
  const snapshot = await typescriptRequest(() => api.createSnapshot({
    fileSystem: createFileSystem([...captured]),
    createPrograms: [{
      rootFiles: [...captured.keys()].filter(path => JS_SOURCE.test(path)),
      // Parse every captured JS/TS input independently of project inclusion and
      // module discovery; the resolver below owns dependency traversal and options.
      compilerOptions: { noLib: true, noResolve: true, allowJs: true, allowNonTsExtensions: true, jsx: JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
    }],
  }));
  return withTypeScriptResource(snapshot, async () => {
  const program = snapshot.operation.createdPrograms[0];
  const roots = [...(repo.config.sourceRoots ?? []), ...repo.config.testRoots];
  const parsed = new Map<string, { imports: readonly string[]; gaps: readonly string[] }>();
  const imports = async (path: string) => {
    const known = parsed.get(path); if (known !== undefined) return known;
    const absolute = resolve(repo.root, path);
    const source = await typescriptRequest(() => program.getSourceFile(absolute));
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
    if ((await typescriptRequest(() => program.getSyntacticDiagnostics(absolute))).length > 0) gaps.add('UnresolvedImport');
    for (const name of names) {
      if (/^(?:node:)?child_process$/u.test(name)) gaps.add('SubprocessBoundary');
      if (/^(?:node:)?(?:https?|net|tls)$/u.test(name)) gaps.add('NetworkBoundary');
    }
    const value = { imports: [...names], gaps: [...gaps] }; parsed.set(path, value); return value;
  };
  const dependencies: DependencyObservation[] = [];
  for (const item of cases.filter(item => JS_SOURCE.test(item.file))) {
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
      const found = await imports(current.path); for (const gap of found.gaps) gaps.add(gap);
      for (const name of found.imports) {
        const resolved = (await typescriptRequest(() => resolver.resolveModuleName(name, dirname(repo.absolute(current.path)), undefined, { snapshot }))).resolvedModule;
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
    dependencies.push({ testId: item.id, scope: 'file', file: item.file, declarations: [...declarations].sort(), edges, gaps: [...gaps].sort() });
  }
  return { analyzer: 'typescript', profile: `typescript/${typescriptPackageVersion()}/dependency-v1`, encoding: 'utf-16', locators: [], dependencies, gaps: [...new Set(dependencies.flatMap(item => item.gaps))] };
  });
  });
}
