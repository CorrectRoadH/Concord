// @concord-file test-annotation-index
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import * as ts from 'typescript';
import { AnnotatedCaseSchema, ConcordError, canonical, decode, digest, objectDigest, type AnnotatedCase, type AnnotationSnapshot, type Finding, type Repository } from './shared.js';

const PARSER_VERSION = `typescript-ast/${ts.version}/concord-annotations-v2`;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const FindingSchema = Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) });
const CachedSnapshotSchema = Schema.Struct({
  cases: Schema.Array(AnnotatedCaseSchema),
  findings: Schema.Array(FindingSchema),
  files: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })),
  digest: Schema.String,
});
type CachedSnapshot = typeof CachedSnapshotSchema.Type;

type Framework = AnnotatedCase['framework'];
interface Binding { readonly framework: Framework; readonly namespace: boolean }
interface Source { readonly path: string; readonly text: string; readonly digest: string }
interface Parsed { readonly cases: AnnotatedCase[]; readonly findings: Finding[] }

function lineAt(source: ts.SourceFile, position: number): number { return source.getLineAndCharacterOfPosition(position).line + 1; }
function finding(findings: Finding[], code: string, path: string, message: string, line?: number): void { findings.push(line === undefined ? { code, path, message } : { code, path, message, line }); }
function runner(module: string): Framework | undefined {
  return module === 'node:test' || module === 'vitest' || module === '@playwright/test' ? module : undefined;
}
function imports(source: ts.SourceFile): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const framework = runner(statement.moduleSpecifier.text);
    if (!framework || !statement.importClause) continue;
    const clause = statement.importClause;
    if (framework === 'node:test' && clause.name) bindings.set(clause.name.text, { framework, namespace: false });
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.set(clause.namedBindings.name.text, { framework, namespace: true });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const specifier of clause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === 'test' || imported === 'it') bindings.set(specifier.name.text, { framework, namespace: false });
    }
  }
  return bindings;
}
function calleeInfo(expression: ts.Expression, bindings: Map<string, Binding>): { readonly binding: Binding; readonly modifier?: 'skip' | 'todo' | 'each' } | undefined {
  if (ts.isIdentifier(expression)) {
    const binding = bindings.get(expression.text);
    return binding && !binding.namespace ? { binding } : undefined;
  }
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  if (ts.isIdentifier(expression.expression)) {
    const binding = bindings.get(expression.expression.text);
    if (binding?.namespace && (expression.name.text === 'test' || expression.name.text === 'it')) return { binding };
  }
  const modifier = expression.name.text;
  if (modifier !== 'skip' && modifier !== 'todo' && modifier !== 'each') return undefined;
  if (ts.isIdentifier(expression.expression)) {
    const binding = bindings.get(expression.expression.text);
    if (binding && !binding.namespace) return { binding, modifier };
  }
  if (ts.isPropertyAccessExpression(expression.expression) && ts.isIdentifier(expression.expression.expression)) {
    const binding = bindings.get(expression.expression.expression.text);
    if (binding?.namespace && (expression.expression.name.text === 'test' || expression.expression.name.text === 'it')) return { binding, modifier };
  }
  return undefined;
}
function staticBooleanOptions(node: ts.Expression): { readonly skipped: boolean } | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  let skipped = false;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) return undefined;
    const name = property.name.text;
    if (name !== 'skip' && name !== 'todo') return undefined;
    if (property.initializer.kind !== ts.SyntaxKind.TrueKeyword && property.initializer.kind !== ts.SyntaxKind.FalseKeyword) return undefined;
    if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) skipped = true;
  }
  return { skipped };
}
function annotationLines(text: string, source: ts.SourceFile, statement: ts.Statement): { readonly values: string[]; readonly lines: number[] } {
  const lines = text.split(/\r?\n/);
  let index = source.getLineAndCharacterOfPosition(statement.getStart(source)).line - 1;
  const values: string[] = [], resultLines: number[] = [];
  while (index >= 0) {
    const match = /^\s*\/\/\s?(.*)$/.exec(lines[index] ?? '');
    if (!match) break;
    values.unshift(match[1] ?? ''); resultLines.unshift(index + 1); index--;
  }
  return { values, lines: resultLines };
}
function parseAnnotations(values: readonly string[], lines: readonly number[], path: string, findings: Finding[]): { readonly id?: string; readonly contract?: string; readonly regressions: string[]; readonly status: 'active' | 'retired'; readonly used: Set<number> } {
  let id: string | undefined, contract: string | undefined, status: 'active' | 'retired' = 'active';
  const regressions: string[] = [], used = new Set<number>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index] ?? '';
    const match = /^@concord-(case|contract|regression|status)(?:\s+(.+?))?\s*$/.exec(value);
    if (!match) continue;
    used.add(lines[index] ?? 0);
    const kind = match[1], argument = match[2]?.trim();
    if (!argument) { finding(findings, 'InvalidAnnotation', path, `@concord-${kind} requires a value`, lines[index]); continue; }
    if (kind === 'case') { if (id !== undefined) finding(findings, 'DuplicateCaseAnnotation', path, 'A test declaration has more than one @concord-case', lines[index]); else id = argument; }
    else if (kind === 'contract') { if (contract !== undefined) finding(findings, 'DuplicateContractAnnotation', path, 'A test declaration has more than one @concord-contract', lines[index]); else contract = argument; }
    else if (kind === 'regression') regressions.push(argument);
    else if (argument === 'retired') status = 'retired';
    else finding(findings, 'InvalidAnnotation', path, '@concord-status must be retired', lines[index]);
  }
  return { id, contract, regressions, status, used };
}
function annotationCommentLines(text: string, source: ts.SourceFile): number[] {
  const lines = new Set<number>();
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\/\/\s*@concord-(?:case|contract|regression|status)\b/.test(text.slice(range.pos, range.end))) lines.add(lineAt(source, range.pos));
    }
  };
  // The parser owns template/regex/JSX token boundaries. A context-free scanner
  // can mistake template text following an interpolation for source comments.
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(source);
    if (children.length > 0) { for (const child of children) visit(child); return; }
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.end));
  };
  visit(source);
  return [...lines].sort((a, b) => a - b);
}
function parseSource(input: Source): Parsed {
  const source = ts.createSourceFile(input.path, input.text, ts.ScriptTarget.Latest, true);
  const bindings = imports(source), findings: Finding[] = [], cases: AnnotatedCase[] = [];
  const attached = new Set<number>();
  const inspect = (call: ts.CallExpression, statement: ts.Statement, supported: boolean): void => {
    const info = calleeInfo(call.expression, bindings);
    if (!info) return;
    const line = lineAt(source, call.getStart(source));
    if (!supported || info.modifier === 'each') { finding(findings, 'UnsupportedTestDeclaration', input.path, 'Only a top-level static test/it call is supported', line); return; }
    const annotations = annotationLines(input.text, source, statement);
    const parsed = parseAnnotations(annotations.values, annotations.lines, input.path, findings);
    for (const item of parsed.used) attached.add(item);
    if (parsed.id === undefined && parsed.contract === undefined && parsed.regressions.length === 0 && parsed.status === 'active') return;
    const [name, second, third] = call.arguments;
    if (!name || !(ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) { finding(findings, 'DynamicTestName', input.path, 'Annotated test declarations need a literal test name', line); return; }
    let callback: ts.Expression | undefined, skipped = info.modifier === 'skip' || info.modifier === 'todo';
    if (call.arguments.length === 2) callback = second;
    else if (call.arguments.length === 3 && second && third) {
      const options = staticBooleanOptions(second);
      if (!options) { finding(findings, 'UnknownTestOptions', input.path, 'Test options must be a static skip/todo object', line); return; }
      skipped ||= options.skipped; callback = third;
    } else { finding(findings, 'AmbiguousTestDeclaration', input.path, 'Annotated test declarations need a literal name and explicit callback', line); return; }
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) { finding(findings, 'AmbiguousTestDeclaration', input.path, 'Annotated test declarations need an explicit callback', line); return; }
    if (!parsed.id) { finding(findings, 'MissingCaseId', input.path, 'Annotated test declaration is missing @concord-case', line); return; }
    if (!parsed.contract) { finding(findings, 'MissingContract', input.path, 'Annotated test declaration is missing @concord-contract', line); return; }
    try { cases.push(decode(AnnotatedCaseSchema, { id: parsed.id, file: input.path, line, name: name.text, contract: parsed.contract, regressions: parsed.regressions, status: parsed.status, framework: info.binding.framework, skipped }, `${input.path}:${line}`)); }
    catch (cause) { finding(findings, 'InvalidAnnotation', input.path, cause instanceof Error ? cause.message : String(cause), line); }
  };
  for (const statement of source.statements) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) inspect(node, statement, false);
      ts.forEachChild(node, visit);
    };
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      inspect(statement.expression, statement, true);
      ts.forEachChild(statement.expression, visit);
    } else ts.forEachChild(statement, visit);
  }
  for (const line of annotationCommentLines(input.text, source)) {
    if (!attached.has(line)) finding(findings, 'OrphanAnnotation', input.path, 'Concord annotation is not immediately attached to a supported test declaration', line);
  }
  return { cases, findings };
}

function sources(repo: Repository): Source[] {
  const paths = [...new Set(repo.config.testRoots.flatMap(root => repo.files(root)))].filter(path => SOURCE_EXTENSION.test(path)).sort();
  return paths.map(path => { const text = repo.read(path); if (text === undefined) throw new ConcordError('SourceChanged', `${path} disappeared while it was scanned`); return { path, text, digest: digest(text) }; });
}
function cachePath(repo: Repository): string { return join(repo.privateDir, 'cache.sqlite'); }
function assertCacheSafe(path: string): void { if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`); }
function cacheKey(repo: Repository, current: readonly Source[]): string {
  return objectDigest({ projectId: repo.config.projectId, root: repo.root, privateDir: repo.privateDir, config: repo.config, parser: PARSER_VERSION, files: current.map(source => ({ path: source.path, digest: source.digest })) });
}
function readCache(repo: Repository, key: string): CachedSnapshot | undefined {
  const path = cachePath(repo); assertCacheSafe(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS annotation_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    const row = db.prepare('SELECT payload FROM annotation_cache WHERE cache_key = ?').get(key) as { payload?: unknown } | undefined;
    if (row?.payload === undefined) return undefined;
    const value = decode(CachedSnapshotSchema, JSON.parse(String(row.payload)), 'annotation cache');
    if (value.digest !== objectDigest({ cases: value.cases, findings: value.findings, files: value.files })) throw new ConcordError('InvalidData', 'annotation cache digest does not match its payload');
    return value;
  }
  finally { db.close(); }
}
function writeCache(repo: Repository, key: string, value: CachedSnapshot): void {
  const path = cachePath(repo); assertCacheSafe(path);
  const db = new DatabaseSync(path);
  try { db.exec('CREATE TABLE IF NOT EXISTS annotation_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL)'); db.exec('BEGIN IMMEDIATE'); try { db.prepare('INSERT OR REPLACE INTO annotation_cache (cache_key, payload) VALUES (?, ?)').run(key, canonical(value)); db.exec('COMMIT'); } catch (cause) { try { db.exec('ROLLBACK'); } catch { /* best effort */ } throw cause; } }
  finally { db.close(); }
}
function unchanged(repo: Repository, before: readonly Source[]): boolean {
  try { const after = sources(repo); return after.length === before.length && after.every((source, index) => source.path === before[index]?.path && source.digest === before[index]?.digest); } catch { return false; }
}
function compile(current: readonly Source[]): CachedSnapshot {
  const parsed = current.map(parseSource);
  const cases = parsed.flatMap(result => result.cases).sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line);
  const findings = parsed.flatMap(result => result.findings);
  const ids = new Map<string, AnnotatedCase>();
  for (const item of cases) { const prior = ids.get(item.id); if (prior) { findings.push({ code: 'DuplicateCaseId', path: item.file, line: item.line, message: `Case ID ${item.id} is also declared at ${prior.file}:${prior.line}` }); } else ids.set(item.id, item); }
  const files = current.map(source => ({ path: source.path, digest: source.digest }));
  const orderedFindings = findings.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.code.localeCompare(b.code));
  return { cases, findings: orderedFindings, files, digest: objectDigest({ cases, findings: orderedFindings, files }) };
}
function snapshot(value: CachedSnapshot, cache: AnnotationSnapshot['cache']): AnnotationSnapshot { return { ...value, cache }; }
function sourceChanged(value: CachedSnapshot, cache: AnnotationSnapshot['cache']): AnnotationSnapshot {
  return snapshot({ ...value, findings: [...value.findings, { code: 'SourceChanged', path: '.', message: 'Source files changed while annotations were scanned' }] }, cache);
}

// @concord-code scan-real-test-annotations
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md
export function scanAnnotations(repo: Repository, options: { cache?: 'use' | 'rebuild' | 'off' } = {}): AnnotationSnapshot {
  const mode = options.cache ?? 'use', path = cachePath(repo); const current = sources(repo); const key = cacheKey(repo, current);
  if (mode === 'off') { const value = compile(current); return unchanged(repo, current) ? snapshot(value, { status: 'off', hits: 0, misses: 1, path }) : sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path }); }
  if (mode === 'use') try { const cached = readCache(repo, key); if (cached) return unchanged(repo, current) ? snapshot(cached, { status: 'hit', hits: 1, misses: 0, path }) : sourceChanged(compile(current), { status: 'source-changed', hits: 0, misses: 1, path }); } catch (cause) { const value = compile(current); return unchanged(repo, current) ? snapshot(value, { status: 'unavailable', hits: 0, misses: 1, path, detail: cause instanceof Error ? cause.message : String(cause) }) : sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path }); }
  const value = compile(current);
  if (!unchanged(repo, current)) return sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path });
  try { writeCache(repo, key, value); return snapshot(value, { status: 'miss', hits: 0, misses: 1, path }); }
  catch (cause) { return snapshot(value, { status: 'unavailable', hits: 0, misses: 1, path, detail: cause instanceof Error ? cause.message : String(cause) }); }
}

export function clearCache(repo: Repository): { readonly status: string; readonly path: string } {
  const path = cachePath(repo); for (const suffix of ['', '-wal', '-shm', '-journal']) { const target = `${path}${suffix}`; assertCacheSafe(target); if (existsSync(target)) rmSync(target); }
  return { status: 'cleared', path };
}
export function cacheStatus(repo: Repository): { readonly status: string; readonly path: string; readonly detail?: string } {
  const path = cachePath(repo); try { assertCacheSafe(path); if (!existsSync(path)) return { status: 'empty', path }; const db = new DatabaseSync(path, { open: false }); db.open(); try { db.prepare('SELECT 1 FROM annotation_cache LIMIT 1').all(); return { status: 'ready', path }; } finally { db.close(); } } catch (cause) { return { status: 'unavailable', path, detail: cause instanceof Error ? cause.message : String(cause) }; }
}
