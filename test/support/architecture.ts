import { withTypeScriptResource } from '../../src/base/process/index.ts';
import { API } from 'typescript/async';
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
  ['documents', 1], ['concepts', 2], ['taste', 2], ['issues', 2], ['docs-work', 2],
  ['writing', 3], ['code', 3], ['tests', 3], ['trace', 4], ['feedback', 4], ['onboarding', 4],
]);
const plain = (file: string, line: number, code: string, text: string): Violation => ({ file, line, code, text });

/** Parse source without evaluating any product module or consumer code. */
export async function inspectArchitecture(root: string, sources?: ReadonlyMap<string, string>): Promise<Audit> {
  const files = sources === undefined ? sourceFiles(root) : [...sources.keys()].sort();
  const known = new Set(files), edges: Edge[] = [], invalid: Violation[] = [], platform: Violation[] = [];
  const api = new API({ runExternalCode: false });
  const local = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith('.')) return;
    const value = relative(root, resolve(root, dirname(from), specifier)).replace(/\.js$/u, '.ts');
    const candidates = [value, `${value}.ts`, `${value}/index.ts`];
    return candidates.find(path => known.has(path));
  };
  await withTypeScriptResource({ dispose: () => api.close() }, async () => {
    for (const file of files) {
      const retained = await api.createSourceFile(resolve(root, file), sources?.get(file) ?? readFileSync(join(root, file), 'utf8'), { scriptKind: ts.ScriptKind.TS });
      await withTypeScriptResource(retained, retained => {
        const source = retained.sourceFile;
        if (file.endsWith('/index.ts')) {
          for (const statement of source.statements) {
            if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
              invalid.push(plain(file, source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1, 'IndexImplementation', statement.getText(source)));
            }
          }
        }
        const variables = new Map<string, ts.Expression[]>(), processAliases = new Set(['process']);
        const processImports = new Map<string, string>(), processMembers = new Map<string, readonly string[]>();
        const processModules = new Set<string>();
        const declarations = (node: ts.Node): void => {
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, [...(variables.get(node.name.text) ?? []), node.initializer]);
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) variables.set(node.left.text, [...(variables.get(node.left.text) ?? []), node.right]);
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && ['process', 'node:process'].includes(node.moduleSpecifier.text)) {
            if (node.importClause?.name) processAliases.add(node.importClause.name.text);
            if (node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) processAliases.add(node.importClause.namedBindings.name.text);
            if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) {
              processModules.add(item.name.text);
              if (node.importClause.phaseModifier !== ts.SyntaxKind.TypeKeyword && !item.isTypeOnly) processImports.set(item.name.text, (item.propertyName ?? item.name).text);
            }
          }
          node.forEachChild(declarations);
        };
        declarations(source);
        const member = (node: ts.Expression): { object: ts.Expression; key: string } | undefined => {
          if (ts.isPropertyAccessExpression(node)) return { object: node.expression, key: node.name.text };
          if (ts.isElementAccessExpression(node) && node.argumentExpression) {
            const keys = values(node.argumentExpression);
            if (keys?.length === 1) return { object: node.expression, key: keys[0]! };
          }
          return undefined;
        };
        const isProcess = (node: ts.Expression, seen = new Set<string>()): boolean => {
          if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return isProcess(node.expression, seen);
          if (ts.isIdentifier(node)) {
            if (processAliases.has(node.text)) return true;
            if (seen.has(node.text)) return false;
            const value = variables.get(node.text);
            return value?.some(item => isProcess(item, new Set([...seen, node.text]))) ?? false;
          }
          const property = member(node);
          return property?.key === 'process' && ts.isIdentifier(property.object) && ['globalThis', 'global'].includes(property.object.text);
        };
        function values(node: ts.Expression, seen = new Set<string>()): readonly string[] | undefined {
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
          if (ts.isParenthesizedExpression(node)) return values(node.expression, seen);
          if (ts.isConditionalExpression(node)) {
            const yes = values(node.whenTrue, seen), no = values(node.whenFalse, seen);
            return yes && no ? [...new Set([...yes, ...no])] : undefined;
          }
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = values(node.left, seen), right = values(node.right, seen);
            return left && right ? left.flatMap(a => right.map(b => a + b)) : undefined;
          }
          if (ts.isIdentifier(node) && !seen.has(node.text)) {
            const initializers = variables.get(node.text)?.map(item => values(item, new Set([...seen, node.text])));
            return initializers?.every(item => item !== undefined) ? [...new Set(initializers.flat())] : undefined;
          }
          const property = member(node);
          if (property?.key === 'href') return values(property.object, seen);
          if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.[0]) return values(node.arguments[0], seen);
          return undefined;
        }
        const capability = (node: ts.Expression, seen = new Set<string>()): readonly string[] => {
          if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return capability(node.expression, seen);
          if (ts.isIdentifier(node)) {
            const imported = processImports.get(node.text), destructured = processMembers.get(node.text);
            if (imported) return [imported];
            if (destructured) return destructured;
            if (seen.has(node.text)) return [];
            return variables.get(node.text)?.flatMap(item => capability(item, new Set([...seen, node.text]))) ?? [];
          }
          const property = member(node);
          if (ts.isCallExpression(node)) {
            const method = member(node.expression);
            if (method?.key === 'bind') return capability(method.object, seen);
          }
          if (property && isProcess(property.object)) return [property.key];
          if (ts.isElementAccessExpression(node) && isProcess(node.expression) && node.argumentExpression) return values(node.argumentExpression) ?? [];
          return [];
        };
        const destructures = (node: ts.Node): void => {
          if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer
            && ts.isIdentifier(node.initializer) && ['globalThis', 'global'].includes(node.initializer.text)) {
            for (const binding of node.name.elements) if (binding.name && ts.isIdentifier(binding.name)
              && (binding.propertyName ?? binding.name).getText(source) === 'process') processAliases.add(binding.name.text);
          }
          if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isProcess(node.initializer)) {
            for (const binding of node.name.elements) {
              if (!binding.name || !ts.isIdentifier(binding.name)) continue;
              const key = binding.propertyName;
              const names = key && ts.isComputedPropertyName(key) ? values(key.expression) : [key && ts.isStringLiteral(key) ? key.text : (key ?? binding.name).getText(source)];
              if (names) processMembers.set(binding.name.text, names);
            }
          }
          node.forEachChild(destructures);
        };
        destructures(source);
        const cli = file.startsWith('src/entry/cli/') && file !== 'src/entry/cli/run.ts';
        const cliCapabilities = new Set(['cwd', 'env', ...(file === 'src/entry/cli/entry.ts' ? [] : ['argv']), 'stdin', 'stdout', 'stderr', 'exitCode', 'exit']);
        const signalMethods = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener', 'removeListener', 'off', 'removeAllListeners']);
        const add = (node: ts.Node, specifier: string, typeOnly: boolean, kind: string, bindings: readonly string[] = []): void => {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const to = local(file, specifier);
          const pinnedNativeRelease = file === 'src/base/installation/hawdb-native-contract.ts' && specifier === '../../../native-release.json' && kind === 'import';
          if (specifier.startsWith('.') && to === undefined && !pinnedNativeRelease) invalid.push(plain(file, line, 'UnresolvedInternalImport', specifier));
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
            if (paths) for (const path of paths) add(node, path, false, 'dynamic');
            else if (file !== 'src/entry/server/test-adapter-vitest-main.ts') invalid.push(location(node, 'UnenumerableDynamicImport'));
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
          if (cli) {
            if (ts.isElementAccessExpression(node) && isProcess(node.expression) && node.argumentExpression && !values(node.argumentExpression)) platform.push(location(node, 'UnenumerableCliHostMember'));
            if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && capability(node).some(name => cliCapabilities.has(name))) platform.push(location(node, 'CliHostProcessCapability'));
            if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isProcess(node.initializer)
              && node.name.elements.some(item => {
                const key = item.propertyName ?? item.name;
                return key && (ts.isComputedPropertyName(key) ? values(key.expression) ?? [] : [ts.isStringLiteral(key) ? key.text : key.getText(source)]).some(name => cliCapabilities.has(name));
              })) platform.push(location(node, 'CliHostProcessDestructure'));
            if (ts.isImportSpecifier(node) && processImports.has(node.name.text) && cliCapabilities.has(processImports.get(node.name.text)!)) platform.push(location(node, 'CliHostProcessImport'));
            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.left) && isProcess(node.right)
              && node.left.properties.some(item => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item))
                && cliCapabilities.has(item.name.getText(source)))) platform.push(location(node, 'CliHostProcessDestructure'));
            if (ts.isCallExpression(node)) {
              const method = member(node.expression), indirect = method && ['call', 'apply'].includes(method.key);
              const event = indirect ? node.arguments[1] : node.arguments[0];
              const argument = method?.key === 'apply' && event && ts.isArrayLiteralExpression(event) ? event.elements[0] : event;
              if (capability(indirect ? method.object : node.expression).some(name => signalMethods.has(name)) && argument
                && values(argument)?.some(name => /^SIG[A-Z0-9]+$/u.test(name))) platform.push(location(node, 'CliHostSignalListener'));
            }
          }
          if (layerOf(file) === 'model') {
            if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].includes(node.expression.text)
              || ts.isPropertyAccessExpression(node.expression) && ['Date.now', 'performance.now', 'Math.random'].includes(node.expression.getText(source)))) invalid.push(location(node, 'ImpureModel'));
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date' && !node.arguments?.length) invalid.push(location(node, 'ImpureModel'));
          }
          node.forEachChild(visit);
        };
        visit(source);
      });
    }
  });
  return { files, edges, invalid, platform };
}

export function dependencyViolations(audit: Audit): Violation[] {
  const result = [...audit.invalid];
  for (const edge of audit.edges) {
    const from = layerOf(edge.from), to = edge.to && layerOf(edge.to);
    const fail = (code: string) => result.push(plain(edge.from, edge.line, code, `${edge.kind}${edge.typeOnly ? ' type' : ''}: ${edge.specifier}`));
    if (!['model', 'base', 'domain', 'app', 'entry'].includes(from)) { fail('UnclassifiedSource'); continue; }
    if (edge.to) {
      const serviceStartup = edge.from === 'src/entry/cli/main.ts' && edge.to === 'src/entry/server/main.ts' && edge.kind === 'dynamic';
      const compiledRole = edge.from === 'src/entry/compiled/run.ts' && edge.kind === 'dynamic' && [
        'src/entry/cli/run.ts', 'src/entry/server/compute-worker-main.ts', 'src/entry/server/editor-worker-main.ts',
        'src/entry/server/query-refresh-worker-main.ts', 'src/entry/server/query-scan-worker-main.ts',
        'src/entry/server/view-scan-worker-main.ts', 'src/entry/server/cache-maintenance-worker-main.ts',
        'src/entry/server/test-adapter-vitest-main.ts', 'src/entry/server/operation/run.ts',
      ].includes(edge.to);
      const compilerSupervisor = edge.from === 'src/entry/compiler/main.ts' && edge.kind === 'import' && edge.to === 'src/base/process/typescript-supervisor.ts'
        || edge.from === 'src/entry/compiled/run.ts' && edge.kind === 'dynamic' && ['src/base/process/typescript-supervisor.ts', 'src/base/installation/location.ts'].includes(edge.to);
      const sourceWebBuilder = edge.from === 'src/entry/web-build/main.ts' && edge.to === 'src/base/installation/source-web-builder.ts' && edge.kind === 'import';
      if (moduleOf(edge.from) !== moduleOf(edge.to) && !edge.to.endsWith('/index.ts') && !serviceStartup && !compiledRole && !sourceWebBuilder && !compilerSupervisor) fail('ModuleExit');
      if (edge.kind === 'export' && moduleOf(edge.from) !== moduleOf(edge.to)) fail('ForeignReexport');
      const root = /^src\/entry\/[^/]+\/(?:[^/]+\/)?main\.ts$/u.test(edge.from) || edge.from === 'src/entry/server/operation/run.ts';
      if (from === 'model' && to !== 'model' || from === 'base' && !['model', 'base'].includes(to!)
        || from === 'domain' && !['model', 'base', 'domain'].includes(to!) || from === 'app' && to === 'entry'
        || from === 'entry' && to !== 'model' && to !== 'app' && moduleOf(edge.from) !== moduleOf(edge.to) && !root && !compiledRole && !compilerSupervisor) fail('LayerDirection');
      if (from === 'entry' && root && (to === 'domain' || to === 'base') && !edge.typeOnly && !compilerSupervisor
        && !edge.bindings.every(name => /(?:Live|Layer|layer)$/u.test(name) || ['RuntimeEnvironment', 'makeRuntimeEnvironment', 'Installation', 'Workspace', 'Sources', 'Publication', 'Cache', 'CacheSnapshot', 'CacheDerivations', 'PersistentCache', 'Git', 'OwnedProcess', 'PublicationValidation', 'ServerRuntime', 'FeedbackCacheWriter', 'SourceWebBuilder'].includes(name))) fail('CompositionRootLayer');
      if (from === 'domain' && to === 'domain' && domainOf(edge.from) !== domainOf(edge.to)) {
        const left = domainLevel.get(domainOf(edge.from)), right = domainLevel.get(domainOf(edge.to));
        if (left === undefined || right === undefined || right >= left) fail('DomainOrder');
      }
    } else if (from === 'model') {
      const allowed = edge.specifier === 'effect' || edge.specifier.startsWith('effect/') || edge.specifier === 'yaml'
        || /^(?:mdast-util-|micromark-)/u.test(edge.specifier) || edge.specifier === 'mdast' && edge.typeOnly
        || edge.specifier === 'node:crypto' && edge.bindings.every(name => name === 'createHash');
      if (!allowed) fail('ModelDependency');
    }
  }
  return result;
}

type LayoutFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
interface LayoutValue {
  readonly scalars?: readonly (string | number | boolean | null | undefined)[];
  readonly texts?: readonly string[];
  readonly symbols?: readonly string[];
  readonly functions?: readonly { readonly module: LayoutModule; readonly node: LayoutFunction; readonly scope: ReadonlyMap<string, LayoutValue> }[];
  readonly items?: readonly LayoutValue[];
  readonly arrays?: readonly (readonly LayoutValue[])[];
  readonly properties?: ReadonlyMap<string, LayoutValue>;
  readonly unknownProperties?: boolean;
  readonly commands?: readonly { readonly executable: LayoutValue; readonly arguments: LayoutValue }[];
  readonly deferred?: readonly LayoutValue[];
  readonly unknown?: boolean;
  readonly abrupt?: boolean;
  readonly returned?: boolean;
}
interface LayoutBinding { readonly expression?: ts.Expression; readonly function?: LayoutFunction; readonly module?: string; readonly name?: string; readonly property?: string }
interface LayoutModule {
  readonly file: string; readonly source: ts.SourceFile;
  readonly bindings: Map<string, LayoutBinding>; readonly exports: Map<string, LayoutBinding>; readonly stars: string[];
}
const unknownLayoutValue: LayoutValue = { unknown: true };
const undefinedLayoutValue: LayoutValue = { scalars: [undefined] };
// Values are immutable: a single choice needs no recursive reconstruction.
const combineLayoutValues = (values: readonly LayoutValue[]): LayoutValue => values.length === 1 ? values[0]! : ({
  scalars: [...new Set(values.flatMap(value => value.scalars ?? []))],
  texts: [...new Set(values.flatMap(value => value.texts ?? []))],
  symbols: [...new Set(values.flatMap(value => value.symbols ?? []))],
  functions: values.flatMap(value => value.functions ?? []),
  commands: values.flatMap(value => value.commands ?? []),
  deferred: values.flatMap(value => value.deferred ?? []),
  ...(values.some(value => value.items) ? { items: values.flatMap(value => value.items ?? []) } : {}),
  ...(values.some(value => value.arrays || value.items) ? { arrays: values.flatMap(value => value.arrays ?? (value.items ? [value.items] : [])) } : {}),
  ...(values.some(value => value.properties) ? { properties: new Map([...new Set(values.flatMap(value => [...(value.properties?.keys() ?? [])]))]
    .map(key => [key, combineLayoutValues(values.map(value => value.properties?.get(key) ?? (value.unknown || value.unknownProperties ? unknownLayoutValue : undefinedLayoutValue)))])) } : {}),
  unknown: values.some(value => value.unknown),
  unknownProperties: values.some(value => value.unknownProperties),
  abrupt: values.length > 0 && values.every(value => value.abrupt),
  returned: values.some(value => value.returned),
});
const layoutTexts = (value: LayoutValue): readonly string[] => [...(value.texts ?? []), ...(value.arrays?.flat() ?? value.items ?? []).flatMap(layoutTexts)];
const layoutTruth = (value: LayoutValue): boolean | undefined => {
  if (value.unknown || value.symbols?.some(symbol => symbol !== '@runCli')) return undefined;
  const choices = [...(value.scalars ?? []).map(Boolean), ...(value.texts ?? []).map(Boolean)];
  if (value.functions?.length || value.items || value.properties || value.commands?.length || value.deferred?.length || value.symbols?.includes('@runCli')) choices.push(true);
  return choices.length && choices.every(choice => choice === choices[0]) ? choices[0] : undefined;
};
const layoutNullish = (value: LayoutValue, onlyUndefined = false): boolean | undefined => {
  if (value.unknown || value.symbols?.some(symbol => symbol !== '@runCli')) return undefined;
  const choices = (value.scalars ?? []).map(item => item === undefined || !onlyUndefined && item === null);
  if (value.texts?.length || value.functions?.length || value.items || value.properties || value.commands?.length || value.deferred?.length || value.symbols?.includes('@runCli')) choices.push(false);
  return choices.length && choices.every(choice => choice === choices[0]) ? choices[0] : undefined;
};
const cliTarget = (text: string): boolean => /(?:^|\/)(?:src|dist)?\/?entry\/cli\/(?:entry|entry-full|cli)\.(?:ts|js)$/u.test(text.replaceAll('\\', '/'))
  || /(?:^|\/)(?:bin|\.bin)\/concord(?:\.cmd)?$/u.test(text.replaceAll('\\', '/')) || /^(?:concord|concord-sdlc)(?:\s|$)/u.test(text);
const processCategories = new Set(['进程终止与信号', 'OS 锁与互斥', '服务与 IPC', '文件监听', '外部程序', '原生模块与句柄', '运行环境', '网络']);

/** Function-level abstract evaluation stays in test helpers; runCli and product services are boundaries. */
export async function inspectTestLayout(root: string, sources?: ReadonlyMap<string, string>): Promise<Violation[]> {
  const files = sources ? [...sources.keys()].sort() : [...sourceFiles(root, 'test'), ...sourceFiles(root, 'scripts'), ...sourceFiles(root, 'bench')];
  const known = new Set(files), violations = new Map<string, Violation>(), modules = new Map<string, LayoutModule>();
  const dispose: (() => Promise<void>)[] = [];
  const parsed = new Map<string, ts.SourceFile>();
  const api = new API({ runExternalCode: false });
  const contents = (file: string) => sources?.get(file) ?? readFileSync(join(root, file), 'utf8');
  const target = (file: string, specifier: string) => {
    if (!specifier.startsWith('.')) return specifier;
    const path = relative(root, resolve(root, dirname(file), specifier)).replaceAll('\\', '/').replace(/\.js$/u, '.ts');
    return [path, `${path}.ts`, `${path}/index.ts`].find(candidate => known.has(candidate)) ?? path;
  };
  const fail = (file: string, node: ts.Node | undefined, code: string, text: string) => {
    const module = modules.get(file);
    const line = node && module ? module.source.getLineAndCharacterOfPosition(node.getStart(module.source)).line + 1 : 1;
    const violation = plain(file, line, code, text);
    violations.set(JSON.stringify(violation), violation);
  };
  const exported = (node: ts.FunctionDeclaration | ts.VariableStatement) => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const moduleFor = (file: string): LayoutModule | undefined => {
    if (!known.has(file) || file.startsWith('src/')) return;
    const prior = modules.get(file);
    if (prior) return prior;
    const module: LayoutModule = { file, source: parsed.get(file)!, bindings: new Map(), exports: new Map(), stars: [] };
    modules.set(file, module);
    for (const statement of module.source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
        const from = target(file, statement.moduleSpecifier.text);
        if (clause.name) module.bindings.set(clause.name.text, { module: from, name: 'default' });
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) module.bindings.set(named.name.text, { module: from, name: '*' });
        if (named && ts.isNamedImports(named)) for (const item of named.elements) if (!item.isTypeOnly) module.bindings.set(item.name.text, { module: from, name: (item.propertyName ?? item.name).text });
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const from = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? target(file, statement.moduleSpecifier.text) : undefined;
        if (!statement.exportClause && from) module.stars.push(from);
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements) if (!item.isTypeOnly) module.exports.set(item.name.text, { ...(from ? { module: from } : {}), name: (item.propertyName ?? item.name).text });
      } else if (ts.isFunctionDeclaration(statement) && statement.name) {
        module.bindings.set(statement.name.text, { function: statement });
        if (exported(statement)) module.exports.set(statement.name.text, { name: statement.name.text });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            module.bindings.set(declaration.name.text, { expression: declaration.initializer });
            if (exported(statement)) module.exports.set(declaration.name.text, { name: declaration.name.text });
          } else if (ts.isObjectBindingPattern(declaration.name)) {
            for (const item of declaration.name.elements) if (item.name && ts.isIdentifier(item.name)) {
              module.bindings.set(item.name.text, { expression: declaration.initializer, property: (item.propertyName ?? item.name).getText(module.source) });
              if (exported(statement)) module.exports.set(item.name.text, { name: item.name.text });
            }
          }
        }
      }
    }
    // A before hook can assign the module's CLI path without executing that hook during the audit.
    const assignments = (node: ts.Node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)
        && module.bindings.has(node.left.text) && module.bindings.get(node.left.text)?.expression === undefined) module.bindings.set(node.left.text, { expression: node.right });
      node.forEachChild(assignments);
    };
    assignments(module.source);
    return module;
  };
  await withTypeScriptResource({ dispose: () => api.close() }, async () => {
    await withTypeScriptResource({ async dispose() {
      const failures: unknown[] = [];
      for (const release of dispose.reverse()) {
        try { await release(); } catch (cause) { failures.push(cause); }
      }
      if (failures.length) throw new AggregateError(failures, 'Architecture source lease cleanup failed');
    } }, async () => {
    for (const file of files.filter(file => !file.startsWith('src/'))) {
      const retained = await api.createSourceFile(resolve(root, file), contents(file), { scriptKind: ts.ScriptKind.TS });
      dispose.push(() => retained.dispose());
      parsed.set(file, retained.sourceFile);
    }
    for (const file of files.filter(file => file.startsWith('test/process/') && file.endsWith('.test.ts'))) {
      const text = contents(file), first = ts.createScanner(false, ts.LanguageVariant.Standard, text, ts.getShebang(text)?.length ?? 0);
      let header = '';
      for (let token = first.scan(); token !== ts.SyntaxKind.EndOfFile; token = first.scan()) {
        if ([ts.SyntaxKind.WhitespaceTrivia, ts.SyntaxKind.NewLineTrivia].includes(token)) continue;
        if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) break;
        header += `${first.getTokenText()}\n`;
      }
      const declarations = [...header.matchAll(/跨进程保证[：:]\s*([^\r\n—]+)——([^\r\n]*)/gu)];
      if (declarations.length === 0) fail(file, undefined, 'MissingProcessGuarantee', 'Top comment block must declare a process boundary and a concrete guarantee');
      for (const declaration of declarations) {
        const category = declaration[1]!.trim(), guarantee = declaration[2]!.replace(/\*\/$/u, '').trim();
        if (!processCategories.has(category) || !guarantee) fail(file, undefined, 'InvalidProcessGuarantee', `${category}——${guarantee}`);
      }
    }
    for (const entry of files.filter(file => file.startsWith('test/cli/') && file.endsWith('.test.ts'))) {
      const resolving = new Set<string>(), active = new Set<ts.Node>();
      const property = (value: LayoutValue, key: string): LayoutValue => {
        if (key === 'href') return value;
        if (key === 'execPath' && value.symbols?.includes('@process')) return { symbols: ['@node'] };
        if (key === 'process' && value.symbols?.includes('@global')) return { symbols: ['@process'] };
        if (/^\d+$/u.test(key) && (value.items || value.arrays)) return combineLayoutValues([
          ...(value.arrays ?? [value.items!]).map(items => items[Number(key)] ?? undefinedLayoutValue), ...(value.unknown ? [unknownLayoutValue] : []),
        ]);
        if (key === 'length' && (value.items || value.arrays)) return { scalars: (value.arrays ?? [value.items!]).map(items => items.length) };
        const found = value.properties?.get(key);
        const imported = (value.symbols ?? []).map(symbol => symbol.startsWith('@module:') ? exportedValue(symbol.slice(8), key) : { symbols: [`${symbol}.${key}`] });
        if (found) return value.unknown ? combineLayoutValues([found, unknownLayoutValue]) : found;
        return imported.length ? combineLayoutValues(imported) : value.properties && !value.unknown && !value.unknownProperties ? undefinedLayoutValue : unknownLayoutValue;
      };
      const bindingValue = (module: LayoutModule, binding: LayoutBinding): LayoutValue => {
        if (binding.module) return binding.name === '*' ? { symbols: [`@module:${binding.module}`] } : exportedValue(binding.module, binding.name ?? 'default');
        if (binding.function) return { functions: [{ module, node: binding.function, scope: new Map() }] };
        if (binding.expression) {
          const value = evaluate(binding.expression, module, new Map());
          return binding.property ? property(value, binding.property) : value;
        }
        return undefinedLayoutValue;
      };
      const namedValue = (module: LayoutModule, name: string): LayoutValue => {
        const key = `${module.file}:${name}`;
        if (resolving.has(key)) return unknownLayoutValue;
        const binding = module.bindings.get(name);
        if (!binding) return name === 'undefined' ? undefinedLayoutValue : name === 'process' ? { symbols: ['@process'] } : ['global', 'globalThis'].includes(name) ? { symbols: ['@global'] } : unknownLayoutValue;
        resolving.add(key);
        try { return bindingValue(module, binding); } finally { resolving.delete(key); }
      };
      function exportedValue(file: string, name: string): LayoutValue {
        if (file === 'test/support/cli.ts' && name === 'runCli') return { symbols: ['@runCli'] };
        if (['node:process', 'process'].includes(file)) {
          if (name === 'default') return { symbols: ['@process'] };
          if (name === 'execPath') return { symbols: ['@node'] };
        }
        if (name === 'default' && /^(?:node:)?(?:child_process|path|url)$/u.test(file)) return { symbols: [`@module:${file}`] };
        const module = moduleFor(file);
        if (!module) return { symbols: [`${file}#${name}`] };
        const binding = module.exports.get(name);
        if (binding) return binding.module ? bindingValue(module, binding) : namedValue(module, binding.name ?? name);
        const key = `${file}:export:${name}`;
        if (resolving.has(key)) return unknownLayoutValue;
        resolving.add(key);
        try { return combineLayoutValues(module.stars.map(from => exportedValue(from, name))); }
        finally { resolving.delete(key); }
      }
      const invoke = (functionValue: LayoutValue, args: readonly LayoutValue[]): LayoutValue => combineLayoutValues((functionValue.functions ?? []).map(fn => {
        if (active.has(fn.node) || !fn.node.body) return unknownLayoutValue;
        const scope = new Map(fn.scope);
        fn.node.parameters.forEach((parameter, index) => {
          let value = parameter.dotDotDotToken ? { items: args.slice(index) } : args[index] ?? undefinedLayoutValue;
          if (parameter.initializer) {
            const missing = layoutNullish(value, true);
            if (missing === true) value = evaluate(parameter.initializer, fn.module, scope);
            else if (missing === undefined) value = combineLayoutValues([value, evaluate(parameter.initializer, fn.module, scope)]);
          }
          bind(parameter.name, value, scope, fn.module);
        });
        active.add(fn.node);
        try { return ts.isBlock(fn.node.body) ? walk(fn.node.body, fn.module, scope) : evaluate(fn.node.body, fn.module, scope); } finally { active.delete(fn.node); }
      }));
      const execute = (value: LayoutValue): LayoutValue => {
        const returned = value.functions?.length ? invoke(value, []) : undefined;
        const deferred = [...(value.deferred ?? []), ...(returned?.deferred ?? [])];
        return deferred.length ? combineLayoutValues(deferred.map(execute)) : returned ?? value;
      };
      function bind(name: ts.BindingName | undefined, value: LayoutValue, scope: Map<string, LayoutValue>, module: LayoutModule): void {
        if (!name) return;
        if (ts.isIdentifier(name)) scope.set(name.text, value);
        else if (ts.isObjectBindingPattern(name)) for (const item of name.elements) {
          const key = item.propertyName ?? item.name;
          if (!key) continue;
          const keys = ts.isComputedPropertyName(key) ? layoutTexts(evaluate(key.expression, module, scope)) : [key.getText(module.source).replace(/^['"]|['"]$/gu, '')];
          let selected = combineLayoutValues(keys.map(key => property(value, key)));
          if (item.initializer && layoutNullish(selected, true) === true) selected = evaluate(item.initializer, module, scope);
          bind(item.name, selected, scope, module);
        } else if (ts.isArrayBindingPattern(name)) name.elements.forEach((item, index) => {
          if (ts.isBindingElement(item)) bind(item.name, property(value, String(index)), scope, module);
        });
      }
      const select = (condition: boolean | undefined, scope: Map<string, LayoutValue>, yes: (scope: Map<string, LayoutValue>) => LayoutValue, no: (scope: Map<string, LayoutValue>) => LayoutValue): LayoutValue => {
        if (condition !== undefined) return (condition ? yes : no)(scope);
        const left = new Map(scope), right = new Map(scope), result = combineLayoutValues([yes(left), no(right)]);
        for (const key of new Set([...left.keys(), ...right.keys()])) {
          const a = left.get(key) ?? undefinedLayoutValue, b = right.get(key) ?? undefinedLayoutValue;
          // Unchanged bindings share identity across branch scopes; retain that value once.
          scope.set(key, a === b ? a : combineLayoutValues([a, b]));
        }
        return result;
      };
      const launch = (executable: LayoutValue, args: LayoutValue, node: ts.Node, module: LayoutModule, fork = false): void => {
        const programs = layoutTexts(executable), arguments_ = layoutTexts(args);
        const evidence = `called by ${entry}: ${node.getText(module.source)}`;
        const nodeProgram = fork || executable.symbols?.includes('@node') || programs.some(program => /(?:^|\/)(?:node(?:\.exe)?|bun)$/u.test(program));
        const shellProgram = programs.some(program => /(?:^|\/)(?:sh|bash|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?)$/u.test(program));
        const reject = () => fail(module.file, node, 'CliHostProcess', evidence);
        if (programs.some(cliTarget) || shellProgram && arguments_.some(argument => argument.split(/\s+/u).some(cliTarget))) { reject(); return; }
        if (programs.some(program => /(?:^|\/)(?:pnpm|npm|yarn|bun|npx)(?:\.(?:cmd|exe))?$/iu.test(program.replaceAll('\\', '/')))) {
          if (args.unknown) fail(module.file, node, 'UnenumerableCliTarget', evidence);
          const optionsWithValue = new Set(['-C', '--dir', '--cwd', '--prefix', '--filter', '-F', '--workspace', '-w', '--package', '-p', '--cache', '--registry']);
          const inspectCommand = (items: readonly LayoutValue[], index = 0): void => {
            const item = items[index];
            if (!item) return;
            const tokens = layoutTexts(item);
            if (item.unknown || tokens.length === 0) fail(module.file, node, 'UnenumerableCliTarget', evidence);
            for (const token of tokens) {
              if (programs.some(program => /(?:^|\/)bun(?:\.exe)?$/u.test(program)) && ['-e', '--eval', '-p', '--print'].includes(token)) fail(module.file, node, 'UnenumerableCliTarget', evidence);
              else if (token.startsWith('-')) inspectCommand(items, index + (optionsWithValue.has(token) ? 2 : 1));
              else if (['exec', 'run', 'x', 'dlx'].includes(token)) inspectCommand(items, index + 1);
              else if (cliTarget(token) || /^concord(?:-sdlc)?@[^/]+$/u.test(token)) reject();
            }
          };
          for (const items of args.arrays ?? [args.items ?? [args]]) inspectCommand(items);
          return;
        }
        if (nodeProgram) {
          for (const items of fork ? [[executable]] : args.arrays ?? [args.items ?? [args]]) {
            let script: LayoutValue | undefined;
            for (let index = 0; index < items.length; index++) {
              const item = items[index]!, texts = layoutTexts(item);
              if (texts.length === 0 || texts.some(text => !text.startsWith('-'))) { script = item; break; }
              if (texts.some(text => ['--import', '--require', '-r', '--loader'].includes(text))) {
                const preload = items[++index] ?? unknownLayoutValue;
                if (layoutTexts(preload).some(cliTarget)) reject();
                else if (preload.unknown || layoutTexts(preload).length === 0) fail(module.file, node, 'UnenumerableCliTarget', evidence);
              } else if (texts.some(text => ['--conditions', '-C'].includes(text))) index++;
              else if (texts.some(text => /^--(?:import|require|loader)=/u.test(text))) {
                if (texts.some(text => cliTarget(text.slice(text.indexOf('=') + 1)))) reject();
              } else if (texts.some(text => ['-e', '--eval', '-p', '--print'].includes(text))) { script = unknownLayoutValue; break; }
            }
            if (script && layoutTexts(script).some(cliTarget)) reject();
            else if (!script || script.unknown || args.unknown || layoutTexts(script).some(text => text.includes('*')) || layoutTexts(script).length === 0) fail(module.file, node, 'UnenumerableCliTarget', evidence);
          }
        } else if (executable.unknown || programs.length === 0 || programs.some(program => program.includes('*'))) fail(module.file, node, 'UnenumerableCliTarget', evidence);
      };
      function evaluate(node: ts.Expression, module: LayoutModule, scope: Map<string, LayoutValue>): LayoutValue {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { texts: [node.text] };
        if (ts.isNumericLiteral(node)) return { scalars: [Number(node.text)] };
        if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { scalars: [node.kind === ts.SyntaxKind.TrueKeyword] };
        if (node.kind === ts.SyntaxKind.NullKeyword) return { scalars: [null] };
        if (ts.isIdentifier(node)) return scope.get(node.text) ?? namedValue(module, node.text);
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) return evaluate(node.expression, module, scope);
        if (ts.isYieldExpression(node)) {
          if (!node.expression) return unknownLayoutValue;
          const value = evaluate(node.expression, module, scope);
          return execute(value);
        }
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { functions: [{ module, node, scope: new Map(scope) }] };
        if (ts.isPropertyAccessExpression(node)) {
          if (node.getText(module.source) === 'import.meta.url') return { texts: [resolve(root, module.file)] };
          return property(evaluate(node.expression, module, scope), node.name.text);
        }
        if (ts.isElementAccessExpression(node) && node.argumentExpression) {
          const value = evaluate(node.expression, module, scope), key = evaluate(node.argumentExpression, module, scope);
          const keys = [...layoutTexts(key), ...(key.scalars ?? []).filter(item => typeof item === 'number').map(String)];
          return combineLayoutValues(keys.map(key => property(value, key)));
        }
        if (ts.isArrayLiteralExpression(node)) return { items: node.elements.flatMap(item => {
          if (ts.isSpreadElement(item)) { const value = evaluate(item.expression, module, scope); return value.items ?? [value]; }
          return [evaluate(item, module, scope)];
        }) };
        if (ts.isObjectLiteralExpression(node)) {
          const properties = new Map<string, LayoutValue>();
          let unknownProperties = false;
          for (const item of node.properties) {
            if (ts.isSpreadAssignment(item)) {
              const spread = evaluate(item.expression, module, scope);
              if (spread.unknown || spread.unknownProperties) {
                unknownProperties = true;
                for (const [key, value] of properties) properties.set(key, combineLayoutValues([value, unknownLayoutValue]));
              }
              for (const [key, value] of spread.properties ?? []) properties.set(key, value);
            }
            if (ts.isPropertyAssignment(item)) properties.set(item.name.getText(module.source).replace(/^['"]|['"]$/gu, ''), evaluate(item.initializer, module, scope));
            if (ts.isShorthandPropertyAssignment(item) && ts.isIdentifier(item.name)) properties.set(item.name.text, evaluate(item.name, module, scope));
            if (ts.isMethodDeclaration(item)) properties.set(item.name.getText(module.source), { functions: [{ module, node: item, scope: new Map(scope) }] });
          }
          return { properties, unknownProperties };
        }
        if (ts.isConditionalExpression(node)) return select(layoutTruth(evaluate(node.condition, module, scope)), scope,
          scope => evaluate(node.whenTrue, module, scope), scope => evaluate(node.whenFalse, module, scope));
        if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
          const truth = layoutTruth(evaluate(node.operand, module, scope));
          return truth === undefined ? unknownLayoutValue : { scalars: [!truth] };
        }
        if (ts.isTemplateExpression(node)) return { texts: [node.head.text + node.templateSpans.map(span => `${layoutTexts(evaluate(span.expression, module, scope))[0] ?? '*'}${span.literal.text}`).join('')] };
        if (ts.isBinaryExpression(node)) {
          const left = evaluate(node.left, module, scope);
          if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
            const truth = node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? layoutNullish(left) : layoutTruth(left);
            return select(truth, scope,
              scope => node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? left : evaluate(node.right, module, scope),
              scope => node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? evaluate(node.right, module, scope) : left);
          }
          const right = evaluate(node.right, module, scope);
          if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) { scope.set(node.left.text, right); return right; }
          if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return { texts: [(`${layoutTexts(left)[0] ?? '*'}${layoutTexts(right)[0] ?? '*'}`)] };
          if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
            const a = [...(left.scalars ?? []), ...(left.texts ?? [])], b = [...(right.scalars ?? []), ...(right.texts ?? [])];
            if (!left.unknown && !right.unknown && a.length && b.length) return { scalars: a.flatMap(a => b.map(b => node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? a === b : a !== b)) };
          }
          if (node.operatorToken.kind === ts.SyntaxKind.InKeyword && right.properties && !right.unknown) return { scalars: layoutTexts(left).map(key => right.properties!.has(key)) };
          return unknownLayoutValue;
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
          const path = node.arguments?.[0] && layoutTexts(evaluate(node.arguments[0], module, scope))[0];
          return path ? { texts: [path.startsWith('.') ? resolve(root, dirname(module.file), path) : path] } : unknownLayoutValue;
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          // A pipe receiver can contain the whole helper graph; evaluate it once per call.
          const access = ts.isPropertyAccessExpression(node.expression) ? node.expression : undefined;
          const receiver = access ? evaluate(access.expression, module, scope) : undefined;
          const callee = receiver && access ? property(receiver, access.name.text) : evaluate(node.expression, module, scope);
          const args = (node.arguments ?? []).map(argument => evaluate(argument, module, scope)), symbols = callee.symbols ?? [];
          if (ts.isPropertyAccessExpression(node.expression)) {
            const target = receiver!, method = node.expression.name.text;
            const offset = args[0]?.scalars?.[0], end = args[1]?.scalars?.[0];
            if (method === 'slice' && (target.items || target.arrays) && typeof offset === 'number') return combineLayoutValues([
              ...(target.arrays ?? [target.items!]).map(items => ({ items: items.slice(offset, typeof end === 'number' ? end : undefined) })), ...(target.unknown ? [unknownLayoutValue] : []),
            ]);
            const text = layoutTexts(target), argument = args[0] && layoutTexts(args[0]);
            if (!target.unknown && target.texts?.length && !target.items && !target.arrays) {
              if (['startsWith', 'endsWith', 'includes'].includes(method) && argument?.length) return { scalars: text.flatMap(text => argument.map(argument => method === 'startsWith' ? text.startsWith(argument) : method === 'endsWith' ? text.endsWith(argument) : text.includes(argument))) };
              if (method === 'slice' && typeof offset === 'number') return { texts: text.map(text => text.slice(offset, typeof end === 'number' ? end : undefined)) };
            }
            if (method === 'includes' && target.items && args[0] && !target.unknown) {
              const items = target.items.flatMap(item => [...(item.texts ?? []), ...(item.scalars ?? [])]);
              if (target.items.every(item => !item.unknown && (item.texts?.length || item.scalars?.length))) return { scalars: [...(args[0].texts ?? []), ...(args[0].scalars ?? [])].map(item => items.includes(item)) };
            }
          }
          if (symbols.includes('@runCli')) return unknownLayoutValue;
          if (symbols.some(symbol => /(?:#Effect\.|\/Effect#)fn(?:Untraced)?$/u.test(symbol))) return args[0]?.functions?.length ? args[0] : { symbols: ['@effectFn'] };
          if (symbols.includes('@effectFn')) return args[0] ?? unknownLayoutValue;
          if (symbols.some(symbol => /(?:#Effect\.|\/Effect#)(?:gen|sync|promise|suspend)$/u.test(symbol))) return { deferred: args };
          if (symbols.some(symbol => /(?:#Effect\.|\/Effect#)(?:try|tryPromise)$/u.test(symbol))) return { deferred: args.map(argument => property(argument, 'try')) };
          if (symbols.some(symbol => /(?:#ChildProcess\.|\/ChildProcess#)make$/u.test(symbol))) return { commands: [{ executable: args[0] ?? unknownLayoutValue, arguments: args[1] ?? unknownLayoutValue }] };
          const native = symbols.find(symbol => /^(?:node:)?child_process#(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)$/u.test(symbol));
          if (native) launch(args[0] ?? unknownLayoutValue, args[1] ?? unknownLayoutValue, node, module, native.endsWith('#fork'));
          const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
          const commands = args.flatMap(argument => argument.commands ?? []);
          if (!native && (method === 'spawn' || commands.length > 0 && ['exitCode', 'string', 'lines', 'stream'].includes(method)
            || symbols.some(symbol => /(?:#ChildProcessSpawner\.|\/ChildProcessSpawner#)(?:ChildProcessSpawner\.)?(?:spawn|exitCode|string|lines|stream)$/u.test(symbol)))) {
            if (commands.length === 0) fail(module.file, node, 'UnenumerableCliTarget', `called by ${entry}: ${node.getText(module.source)}`);
            for (const command of commands) launch(command.executable, command.arguments, node, module);
          }
          if (symbols.some(symbol => /^(?:node:)?path#(?:join|resolve|dirname)$/u.test(symbol))) {
            const parts = args.map(argument => layoutTexts(argument)[0] ?? '*');
            return { texts: [symbols.some(symbol => symbol.endsWith('#dirname')) ? dirname(parts[0] ?? '*') : parts.join('/')] };
          }
          if (symbols.some(symbol => /^(?:node:)?url#(?:fileURLToPath|pathToFileURL)$/u.test(symbol))) return args[0] ?? unknownLayoutValue;
          const returned = invoke(callee, args);
          if (callee.functions?.length) return returned;
          if (symbols.some(symbol => /(?:#Effect\.|\/Effect#)(?:runPromise|runSync|forkScoped|forkIn)$/u.test(symbol))) return combineLayoutValues(args.map(execute));
          if (symbols.some(symbol => /(?:#Effect\.|\/Effect#)(?:scoped|provide|provideService|all|asVoid)$/u.test(symbol)) || method === 'pipe') return combineLayoutValues(args.concat(receiver ? [receiver] : []));
          for (const arg of args) execute(arg);
          return unknownLayoutValue;
        }
        return unknownLayoutValue;
      }
      function walk(node: ts.Node, module: LayoutModule, scope: Map<string, LayoutValue>): LayoutValue {
        if (ts.isSourceFile(node) || ts.isBlock(node)) {
          const returned: LayoutValue[] = [];
          let abrupt = false;
          for (const statement of node.statements) {
            const result = walk(statement, module, scope);
            if (result.returned) returned.push(result);
            if (result.abrupt) { abrupt = true; break; }
          }
          return { ...combineLayoutValues([...returned, ...(abrupt ? [] : [undefinedLayoutValue])]), abrupt, returned: returned.length > 0 };
        }
        if (ts.isIfStatement(node)) return select(layoutTruth(evaluate(node.expression, module, scope)), scope,
          scope => walk(node.thenStatement, module, scope), scope => node.elseStatement ? walk(node.elseStatement, module, scope) : {});
        if (ts.isForOfStatement(node)) {
          const iterable = evaluate(node.expression, module, scope), items = iterable.items ?? [unknownLayoutValue];
          const returned: LayoutValue[] = [];
          for (const item of items) {
            if (ts.isVariableDeclarationList(node.initializer)) for (const declaration of node.initializer.declarations) bind(declaration.name, item, scope, module);
            else if (ts.isIdentifier(node.initializer)) scope.set(node.initializer.text, item);
            returned.push(walk(node.statement, module, scope));
          }
          return { ...combineLayoutValues(returned), abrupt: false };
        }
        if (ts.isFunctionDeclaration(node)) { if (node.name) scope.set(node.name.text, { functions: [{ module, node, scope: new Map(scope) }] }); return {}; }
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return evaluate(node, module, scope);
        if (ts.isVariableDeclaration(node)) {
          const value = node.initializer ? evaluate(node.initializer, module, scope) : undefinedLayoutValue;
          bind(node.name, value, scope, module);
          return {};
        }
        if (ts.isReturnStatement(node)) return { ...(node.expression ? evaluate(node.expression, module, scope) : undefinedLayoutValue), abrupt: true, returned: true };
        if (ts.isThrowStatement(node)) { evaluate(node.expression, module, scope); return { abrupt: true }; }
        if (ts.isExpressionStatement(node)) { evaluate(node.expression, module, scope); return {}; }
        if (ts.isCallExpression(node) || ts.isYieldExpression(node) || ts.isAwaitExpression(node) || ts.isBinaryExpression(node)) return evaluate(node, module, scope);
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return {};
        const results: LayoutValue[] = [];
        node.forEachChild(child => { results.push(walk(child, module, scope)); });
        return combineLayoutValues(results);
      }
      const module = moduleFor(entry);
      if (module) walk(module.source, module, new Map());
    }
    });
  });
  return [...violations.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.text.localeCompare(b.text));
}
