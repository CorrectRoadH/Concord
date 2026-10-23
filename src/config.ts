import { Predicate } from 'effect';
import { readCachedProjectConfig } from './config-cache.js';
import { ConcordError, ProjectSchema, decode, digest, type ConfigSnapshot, type ProjectConfig } from './shared.js';
import * as ts from 'typescript/ast';
import { withTypeScriptSource, typescriptPackageVersion } from './typescript-host.js';
import { ContentCache } from './content-cache.js';

const configContentCache = new ContentCache<ProjectConfig>('document_parse', `typescript-ast/${typescriptPackageVersion()}/concord-config-parse/v1`, ProjectSchema, { maxEntries: 128, maxBytes: 1024 * 1024 });

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) return unwrap(expression.expression);
  return expression;
}

function literal(expression: ts.Expression, source: string): unknown {
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
  return withTypeScriptSource(path, source, (file, diagnostics) => {
    if (diagnostics.length > 0) throw new ConcordError('InvalidConfigSyntax', `${path}: ${diagnostics.map(item => item.text).join('; ')}`);
    let exported: ts.ExportAssignment | undefined;
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement) && (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword || statement.importClause?.name === undefined && statement.importClause?.phaseModifier === undefined && statement.importClause?.namedBindings !== undefined && ts.isNamedImports(statement.importClause.namedBindings) && statement.importClause.namedBindings.elements.length > 0 && statement.importClause.namedBindings.elements.every(element => element.isTypeOnly))) continue;
      if (ts.isExportAssignment(statement) && !statement.isExportEquals && exported === undefined) { exported = statement; continue; }
      throw new ConcordError('InvalidConfigSyntax', `${path}: only type imports and one export default static object are permitted`);
    }
    if (exported === undefined) throw new ConcordError('InvalidConfigSyntax', `${path}: expected one export default static object`);
    const value = literal(exported.expression, path);
    try { return decode(ProjectSchema, value, path); }
    catch (cause) {
      if (Predicate.isObject(value) && Object.hasOwn(value, 'languageServers') && cause instanceof ConcordError && cause.message.includes('languageServers')) throw new ConcordError('InvalidLanguageServer', cause.message);
      throw cause;
    }
  });
}
// @concord-end

// @concord-code
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
export function renderTypeScriptConfig(config: ProjectConfig): string {
  const valid = decode(ProjectSchema, config, 'configuration');
  return `import type { ProjectConfig } from 'concord-sdlc/config';\n\nexport default ${JSON.stringify(valid, null, 2)} as const satisfies ProjectConfig;\n`;
}

// @concord-code
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
export function snapshot(path: ConfigSnapshot['path'], source: string, privateDir?: string): ConfigSnapshot {
  if (path !== 'concord.config.ts') throw new ConcordError('ProjectMigrationRequired', 'Runtime configuration must be concord.config.ts; migrate old configuration explicitly offline');
  const sourceDigest = digest(source);
  const config = configContentCache.get(path, source, () => {
    const cached = privateDir === undefined ? undefined : readCachedProjectConfig(privateDir, sourceDigest);
    return cached ?? parseTypeScriptConfig(source, path);
  });
  return { path, source, digest: sourceDigest, config };
}
