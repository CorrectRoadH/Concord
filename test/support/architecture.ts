import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export interface Edge {
  readonly from: string; readonly to?: string; readonly specifier: string;
  readonly typeOnly: boolean; readonly kind: string; readonly line: number;
  readonly bindings: readonly string[];
}
export interface Violation { readonly file: string; readonly line: number; readonly code: string; readonly text: string }
export interface Audit { readonly files: readonly string[]; readonly edges: readonly Edge[]; readonly invalid: readonly Violation[]; readonly platform: readonly Violation[] }
export const sourceFiles = (root: string, directory = 'src'): string[] => readdirSync(join(root, directory), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? sourceFiles(root, `${directory}/${entry.name}`) : entry.isFile() && entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : []).sort();
export const moduleOf = (file: string): string => dirname(file);
const layerOf = (file: string): string => file.split('/')[1] ?? '';
const domainOf = (file: string): string => file.split('/')[2] ?? '';
const domainLevel = new Map([
  ['documents', 1], ['concepts', 2], ['constitution', 2], ['designs', 2], ['issues', 2], ['memory', 2], ['docs-work', 2],
  ['writing', 3], ['code', 3], ['tests', 3], ['trace', 4], ['feedback', 4], ['onboarding', 4],
]);
const plain = (file: string, line: number, code: string, text: string): Violation => ({ file, line, code, text });

/** Parse source without evaluating any product module or consumer code. */
export function inspectArchitecture(root: string, sources?: ReadonlyMap<string, string>): Audit {
  const files = sources === undefined ? sourceFiles(root) : [...sources.keys()].sort();
  const known = new Set(files), edges: Edge[] = [], invalid: Violation[] = [], platform: Violation[] = [];
  const api = new API({ runExternalCode: false });
  const local = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith('.')) return;
    const value = relative(root, resolve(root, dirname(from), specifier)).replace(/\.js$/u, '.ts');
    const candidates = [value, `${value}.ts`, `${value}/index.ts`];
    if (value.endsWith('/cli-fallback-bundle.ts')) candidates.push(value.replace('cli-fallback-bundle.ts', 'cli-fallback.ts'));
    return candidates.find(path => known.has(path));
  };
  try {
    for (const file of files) {
      const retained = api.createSourceFile(resolve(root, file), sources?.get(file) ?? readFileSync(join(root, file), 'utf8'), { scriptKind: ts.ScriptKind.TS });
      try {
        const source = retained.sourceFile;
        const variables = new Map<string, ts.Expression>(), processAliases = new Set(['process']);
        const processModules = new Set<string>();
        const declarations = (node: ts.Node): void => {
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && ['process', 'node:process'].includes(node.moduleSpecifier.text)) {
            if (node.importClause?.name) processAliases.add(node.importClause.name.text);
            if (node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) processAliases.add(node.importClause.namedBindings.name.text);
            if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) processModules.add(item.name.text);
          }
          node.forEachChild(declarations);
        };
        declarations(source);
        const member = (node: ts.Expression): { object: ts.Expression; key: string } | undefined => {
          if (ts.isPropertyAccessExpression(node)) return { object: node.expression, key: node.name.text };
          if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) return { object: node.expression, key: node.argumentExpression.text };
          return undefined;
        };
        const isProcess = (node: ts.Expression, seen = new Set<string>()): boolean => {
          if (ts.isIdentifier(node)) {
            if (processAliases.has(node.text)) return true;
            if (seen.has(node.text)) return false;
            const value = variables.get(node.text);
            return value === undefined ? false : isProcess(value, new Set([...seen, node.text]));
          }
          const property = member(node);
          return property?.key === 'process' && ts.isIdentifier(property.object) && ['globalThis', 'global'].includes(property.object.text);
        };
        const values = (node: ts.Expression, seen = new Set<string>()): readonly string[] | undefined => {
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
          if (ts.isParenthesizedExpression(node)) return values(node.expression, seen);
          if (ts.isConditionalExpression(node)) {
            const yes = values(node.whenTrue, seen), no = values(node.whenFalse, seen);
            return yes && no ? [...new Set([...yes, ...no])] : undefined;
          }
          if (ts.isIdentifier(node) && !seen.has(node.text)) {
            const initializer = variables.get(node.text);
            return initializer ? values(initializer, new Set([...seen, node.text])) : undefined;
          }
          const property = member(node);
          if (property?.key === 'href') return values(property.object, seen);
          if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.[0]) return values(node.arguments[0], seen);
          return undefined;
        };
        const add = (node: ts.Node, specifier: string, typeOnly: boolean, kind: string, bindings: readonly string[] = []): void => {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const to = local(file, specifier);
          if (specifier.startsWith('.') && to === undefined) invalid.push(plain(file, line, 'UnresolvedInternalImport', specifier));
          edges.push({ from: file, ...(to === undefined ? {} : { to }), specifier, typeOnly, kind, line, bindings });
        };
        const location = (node: ts.Node, code: string): Violation => plain(file, source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, code, node.getText(source));
        const visit = (node: ts.Node): void => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause, named = clause?.namedBindings;
            const bindings = named && ts.isNamedImports(named) ? named.elements : [];
            const types = (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) ? [true] : bindings.length ? [...new Set(bindings.map(binding => binding.isTypeOnly))] : [false];
            if (clause?.name && !(clause.phaseModifier === ts.SyntaxKind.TypeKeyword) && !types.includes(false)) types.push(false);
            for (const typeOnly of types) add(node, node.moduleSpecifier.text, typeOnly, 'import', bindings.filter(binding => !!(clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) || binding.isTypeOnly === typeOnly).map(binding => (binding.propertyName ?? binding.name).text));
          } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
            for (const typeOnly of node.isTypeOnly ? [true] : named.length ? [...new Set(named.map(binding => binding.isTypeOnly))] : [false]) add(node, node.moduleSpecifier.text, typeOnly, 'export', named.map(binding => (binding.propertyName ?? binding.name).text));
          } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            add(node, node.argument.literal.text, true, 'import-type');
          } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const argument = node.arguments[0], paths = argument && values(argument);
            if (file === 'src/base/installation/startup/index.ts' && paths?.length === 1 && paths[0] === 'dist/startup-data.js') {
              edges.push({ from: file, specifier: paths[0], typeOnly: false, kind: 'generated-installation-resource', line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, bindings: [] });
            } else if (paths) for (const path of paths) add(node, path, false, 'dynamic');
            else if (file !== 'src/entry/server/test-adapter-vitest.ts') invalid.push(location(node, 'UnenumerableDynamicImport'));
          }
          if (!['base', 'entry'].includes(layerOf(file))) {
            if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
              && /^(?:node:)?(?:fs(?:\/promises)?|child_process|net|process)$/u.test(node.moduleSpecifier.text)) platform.push(location(node, 'PlatformModule'));
            if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
              const property = member(node);
              if (property && ['cwd', 'env', 'argv', 'stdin', 'stdout', 'stderr'].includes(property.key) && isProcess(property.object)) platform.push(location(node, 'ProcessCapability'));
            }
            if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isProcess(node.initializer)
              && node.name.elements.some(item => ['cwd', 'env', 'argv', 'stdin', 'stdout', 'stderr'].includes((item.propertyName ?? item.name)?.getText(source) ?? ''))) platform.push(location(node, 'ProcessDestructure'));
            if (ts.isIdentifier(node) && processModules.has(node.text) && !ts.isImportSpecifier(node.parent)) platform.push(location(node, 'ProcessImportCapability'));
          }
          if (layerOf(file) === 'model') {
            if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].includes(node.expression.text)
              || ts.isPropertyAccessExpression(node.expression) && ['Date.now', 'performance.now', 'Math.random'].includes(node.expression.getText(source)))) invalid.push(location(node, 'ImpureModel'));
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date' && !node.arguments?.length) invalid.push(location(node, 'ImpureModel'));
          }
          node.forEachChild(visit);
        };
        visit(source);
      } finally { retained.dispose(); }
    }
  } finally { api.close(); }
  return { files, edges, invalid, platform };
}

export function dependencyViolations(audit: Audit): Violation[] {
  const result = [...audit.invalid];
  for (const edge of audit.edges) {
    const from = layerOf(edge.from), to = edge.to && layerOf(edge.to);
    const fail = (code: string) => result.push(plain(edge.from, edge.line, code, `${edge.kind}${edge.typeOnly ? ' type' : ''}: ${edge.specifier}`));
    if (!['model', 'base', 'domain', 'app', 'entry'].includes(from)) { fail('UnclassifiedSource'); continue; }
    if (edge.to) {
      if (moduleOf(edge.from) !== moduleOf(edge.to) && !edge.to.endsWith('/index.ts')) fail('ModuleExit');
      if (edge.kind === 'export' && moduleOf(edge.from) !== moduleOf(edge.to)) fail('ForeignReexport');
      const root = /^src\/entry\/[^/]+\/main\.ts$/u.test(edge.from);
      if (from === 'model' && to !== 'model' || from === 'base' && !['model', 'base'].includes(to!)
        || from === 'domain' && !['model', 'base', 'domain'].includes(to!) || from === 'app' && to === 'entry'
        || from === 'entry' && to !== 'model' && to !== 'app' && moduleOf(edge.from) !== moduleOf(edge.to) && !root) fail('LayerDirection');
      if (from === 'entry' && root && (to === 'domain' || to === 'base') && !edge.typeOnly
        && !edge.bindings.every(name => /(?:Live|Layer|layer)$/u.test(name) || ['Installation', 'Workspace', 'Sources', 'Publication', 'Cache', 'CacheSnapshot', 'PersistentCache', 'Git', 'OwnedProcess', 'PublicationValidation'].includes(name))) fail('CompositionRootLayer');
      if (from === 'domain' && to === 'domain' && domainOf(edge.from) !== domainOf(edge.to)) {
        const left = domainLevel.get(domainOf(edge.from)), right = domainLevel.get(domainOf(edge.to));
        if (left === undefined || right === undefined || right >= left) fail('DomainOrder');
      }
    } else if (from === 'model' && edge.kind !== 'generated-installation-resource') {
      const allowed = edge.specifier === 'effect' || edge.specifier.startsWith('effect/') || edge.specifier === 'yaml'
        || /^(?:mdast-util-|micromark-)/u.test(edge.specifier) || edge.specifier === 'mdast' && edge.typeOnly
        || edge.specifier === 'node:crypto' && edge.bindings.every(name => name === 'createHash');
      if (!allowed) fail('ModelDependency');
    }
  }
  return result;
}

export function domainCycles(audit: Audit, typeOnly: boolean): readonly string[] {
  const graph = new Map<string, Set<string>>();
  for (const edge of audit.edges) if (edge.to && edge.typeOnly === typeOnly && layerOf(edge.from) === 'domain' && layerOf(edge.to) === 'domain') {
    const from = domainOf(edge.from), to = domainOf(edge.to);
    if (from !== to) { const targets = graph.get(from) ?? new Set(); targets.add(to); graph.set(from, targets); }
  }
  const cycles = new Set<string>();
  const visit = (node: string, path: readonly string[]): void => {
    if (path.includes(node)) { cycles.add([...path.slice(path.indexOf(node)), node].join(' -> ')); return; }
    for (const target of graph.get(node) ?? []) visit(target, [...path, node]);
  };
  for (const node of graph.keys()) visit(node, []);
  return [...cycles].sort();
}
export const violationKey = (violation: Violation): string => `${violation.file}#${violation.code}#${violation.text}`;
