// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
import { readCachedProjectConfig } from './config-cache.js';
import { ConcordError, ProjectSchema, decode, digest, type ConfigSnapshot, type ProjectConfig } from './shared.js';
import type * as TypeScript from 'typescript';
import { lazyTypeScript } from './typescript-host.js';

const ts = lazyTypeScript();

function unwrap(expression: TypeScript.Expression): TypeScript.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) return unwrap(expression.expression);
  return expression;
}

function literal(expression: TypeScript.Expression, source: string): unknown {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => {
    if (ts.isSpreadElement(item) || ts.isOmittedExpression(item)) throw new ConcordError('InvalidConfigSyntax', `${source}: arrays cannot contain spreads or holes`);
    return literal(item, source);
  });
  if (ts.isObjectLiteralExpression(node)) {
    // A normal object would invoke Object.prototype.__proto__'s setter before
    // strict schema decoding gets a chance to reject that excess property.
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || property.name === undefined || ts.isComputedPropertyName(property.name)) throw new ConcordError('InvalidConfigSyntax', `${source}: configuration must contain only explicit property assignments`);
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name) ? property.name.text : undefined;
      if (name === undefined) throw new ConcordError('InvalidConfigSyntax', `${source}: unsupported property name`);
      if (Object.hasOwn(value, name)) throw new ConcordError('InvalidConfigSyntax', `${source}: duplicate property ${name}`);
      value[name] = literal(property.initializer, source);
    }
    return value;
  }
  throw new ConcordError('InvalidConfigSyntax', `${source}: runtime expressions are not permitted in static configuration`);
}

export function parseTypeScriptConfig(source: string, path = 'concord.config.ts'): ProjectConfig {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (file as TypeScript.SourceFile & { readonly parseDiagnostics?: readonly TypeScript.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw new ConcordError('InvalidConfigSyntax', `${path}: ${diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('; ')}`);
  let exported: TypeScript.ExportAssignment | undefined;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && (statement.importClause?.isTypeOnly === true || statement.importClause?.name === undefined && statement.importClause?.namedBindings !== undefined && ts.isNamedImports(statement.importClause.namedBindings) && statement.importClause.namedBindings.elements.length > 0 && statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly))) continue;
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && exported === undefined) { exported = statement; continue; }
    throw new ConcordError('InvalidConfigSyntax', `${path}: only type imports and one export default static object are permitted`);
  }
  if (exported === undefined) throw new ConcordError('InvalidConfigSyntax', `${path}: expected one export default static object`);
  const value = literal(exported.expression, path);
  return decode(ProjectSchema, value, path);
}

export function renderTypeScriptConfig(config: ProjectConfig): string {
  const valid = decode(ProjectSchema, config, 'configuration');
  return `import type { ProjectConfig } from 'concord-sdlc/config';\n\nexport default ${JSON.stringify(valid, null, 2)} as const satisfies ProjectConfig;\n`;
}

export function snapshot(path: ConfigSnapshot['path'], source: string, privateDir?: string): ConfigSnapshot {
  if (path !== 'concord.config.ts') throw new ConcordError('ProjectMigrationRequired', 'Runtime configuration must be concord.config.ts; migrate old configuration explicitly offline');
  const sourceDigest = digest(source);
  if (privateDir !== undefined) {
    const cached = readCachedProjectConfig(privateDir, sourceDigest);
    if (cached !== undefined) return { path, source, digest: sourceDigest, config: cached };
  }
  const config = parseTypeScriptConfig(source, path);
  return { path, source, digest: sourceDigest, config };
}
