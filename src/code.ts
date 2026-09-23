// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { cacheDatabasePath } from './cache-file.js';
import { readCodePayloads, writeCodePayloads } from './code-cache.js';
import { persistNotedConfig } from './config-cache.js';
import { decode, canonical, digest, objectDigest, Slug, Text, type Finding, type Repository } from './shared.js';
import { parseReference } from './refs.js';
import { ContentCache } from './content-cache.js';
import type * as TypeScript from 'typescript';
import { lazyTypeScript, typescriptPackageVersion } from './typescript-host.js';

const ts = lazyTypeScript();

export const CodeDeclarationSchema = Schema.Struct({
  id: Slug,
  file: Text,
  line: Schema.Int,
  endLine: Schema.Int,
  scope: Schema.Literals(['file', 'node', 'region']),
  symbol: Schema.optional(Text),
  contracts: Schema.Array(Text),
});
export type CodeDeclaration = {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly endLine: number;
  readonly scope: 'file' | 'node' | 'region';
  readonly symbol?: string;
  readonly contracts: readonly string[];
};

export interface CodeCacheStatus {
  readonly status: string;
  readonly hits: number;
  readonly misses: number;
  readonly path: string;
  readonly detail?: string;
}
export interface CodeSnapshot {
  readonly codes: readonly CodeDeclaration[];
  readonly findings: readonly Finding[];
  readonly files: readonly { readonly path: string; readonly digest: string }[];
  readonly digest: string;
  readonly cache: CodeCacheStatus;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
const CODE_FAMILIES = new Set(['file', 'code', 'begin', 'end', 'implements']);
const OTHER_FAMILIES = new Set(['case', 'contract', 'regression', 'status', 'owner', 'test-file', 'issue', 'history', 'tombstone']);
const FindingSchema = Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) });
const CodeSnapshotSchema = Schema.Struct({
  codes: Schema.Array(CodeDeclarationSchema),
  findings: Schema.Array(FindingSchema),
  files: Schema.Array(Schema.Struct({ path: Text, digest: Text })),
  digest: Text,
});
const CodeParseSchema = Schema.Struct({
  codes: Schema.Array(CodeDeclarationSchema),
  findings: Schema.Array(FindingSchema),
  digest: Text,
});
type CodeMode = 'use' | 'rebuild' | 'off';
type ParsedFile = { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] };
interface CompiledFiles {
  readonly codes: readonly CodeDeclaration[];
  readonly findings: readonly Finding[];
  readonly hits: number;
  readonly misses: number;
  readonly rows: readonly { readonly key: string; readonly payload: string }[];
  readonly readFailure?: string;
}

interface Source { readonly path: string; readonly text: string; readonly digest: string }
interface LineComment {
  readonly pos: number;
  readonly end: number;
  readonly line: number;
  readonly family: string;
  readonly argument?: string;
  readonly ownLine: boolean;
}
interface StartMarker extends LineComment {
  readonly family: 'file' | 'code' | 'begin';
  readonly valid: boolean;
  readonly contracts: readonly string[];
  readonly blockEnd: number;
}
interface StatementContext { readonly node: TypeScript.Node; readonly statements: readonly TypeScript.Statement[]; readonly pos: number; readonly end: number }
interface Gap { readonly context: StatementContext; readonly index: number }
interface RegionPair { readonly begin: StartMarker; readonly end: LineComment }
interface RegionCandidate { readonly pair: RegionPair; readonly context: StatementContext; readonly first: TypeScript.Statement; readonly last: TypeScript.Statement }
type LocatorPart = readonly [kind: string, staticName: string | null, siblingOrdinal: number];
type Locator = readonly LocatorPart[];

class CodeSourceReadChanged extends Error {}

function addFinding(findings: Finding[], code: string, path: string, message: string, line?: number): void {
  findings.push(line === undefined ? { code, path, message } : { code, path, message, line });
}

function lineAt(source: TypeScript.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(Math.max(0, Math.min(position, source.text.length))).line + 1;
}

function lineBounds(text: string, pos: number, end: number): { readonly ownLine: boolean; readonly end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline < 0 ? text.length : newline;
  return { ownLine: /^\s*$/u.test(text.slice(start, pos)) && /^\s*$/u.test(text.slice(end, lineEnd).replace(/\r$/u, '')), end: newline < 0 ? text.length : newline + 1 };
}

/** Only comments reported by TypeScript's comment ranges can own a declaration. */
function actualLineComments(source: TypeScript.SourceFile): readonly LineComment[] {
  const ranges = new Map<number, TypeScript.CommentRange>();
  const tokenSpans: { readonly start: number; readonly end: number }[] = [];
  const collect = (items: readonly TypeScript.CommentRange[] | undefined): void => {
    for (const range of items ?? []) if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) ranges.set(range.pos, range);
  };
  const visit = (node: TypeScript.Node): void => {
    const children = node.getChildren(source);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    tokenSpans.push({ start: node.getStart(source), end: node.end });
    collect(ts.getLeadingCommentRanges(source.text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source.text, node.end));
  };
  visit(source);
  const comments: LineComment[] = [];
  for (const range of [...ranges.values()].sort((left, right) => left.pos - right.pos)) {
    if (tokenSpans.some(span => range.pos >= span.start && range.pos < span.end)) continue;
    const match = /^\/\/\s*@concord-([^\s]+)(?:\s+(.+?))?\s*$/u.exec(source.text.slice(range.pos, range.end));
    if (match === null) continue;
    const bounds = lineBounds(source.text, range.pos, range.end);
    comments.push({ pos: range.pos, end: bounds.end, line: lineAt(source, range.pos), family: match[1]!, ...(match[2] === undefined ? {} : { argument: match[2].trim() }), ownLine: bounds.ownLine });
  }
  return comments;
}

function startMarkers(comments: readonly LineComment[], path: string, findings: Finding[]): { readonly starts: readonly StartMarker[]; readonly consumedImplements: ReadonlySet<number> } {
  const byLine = new Map(comments.map(comment => [comment.line, comment]));
  const consumed = new Set<number>();
  const starts: StartMarker[] = [];
  for (const comment of comments) {
    if (comment.family !== 'file' && comment.family !== 'code' && comment.family !== 'begin') continue;
    let valid = comment.ownLine && comment.argument === undefined;
    const implementations: LineComment[] = [];
    for (let line = comment.line + 1;; line++) {
      const next = byLine.get(line);
      if (next === undefined || next.family !== 'implements' || !next.ownLine) break;
      implementations.push(next);
      consumed.add(next.pos);
    }
    if (implementations.length === 0) {
      addFinding(findings, 'MissingCodeContract', path, `@concord-${comment.family} must be followed immediately by at least one @concord-implements`, comment.line);
      valid = false;
    }
    const contracts: string[] = [];
    for (const implementation of implementations) {
      if (implementation.argument === undefined) {
        addFinding(findings, 'InvalidCodeContract', path, '@concord-implements requires one canonical reference', implementation.line);
        valid = false;
        continue;
      }
      try {
        const reference = parseReference(implementation.argument).ref;
        if (contracts.includes(reference)) {
          addFinding(findings, 'DuplicateCodeContract', path, `Code declaration repeats ${reference}`, implementation.line);
          valid = false;
        } else contracts.push(reference);
      } catch (cause) {
        addFinding(findings, 'InvalidCodeContract', path, cause instanceof Error ? cause.message : String(cause), implementation.line);
        valid = false;
      }
    }
    starts.push({ ...comment, family: comment.family, valid, contracts, blockEnd: implementations.at(-1)?.end ?? comment.end });
  }
  return { starts, consumedImplements: consumed };
}

function statementContexts(source: TypeScript.SourceFile): readonly StatementContext[] {
  const contexts: StatementContext[] = [];
  const add = (node: TypeScript.Node, statements: TypeScript.NodeArray<TypeScript.Statement>, end: number): void => {
    contexts.push({ node, statements: [...statements], pos: statements.pos, end });
  };
  const visit = (node: TypeScript.Node): void => {
    if (ts.isSourceFile(node)) add(node, node.statements, node.end);
    else if (ts.isBlock(node) || ts.isModuleBlock(node)) add(node, node.statements, Math.max(node.statements.pos, node.getEnd() - 1));
    else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const block = node.parent;
      const next = block.clauses[block.clauses.indexOf(node) + 1];
      add(node, node.statements, next?.getStart(source) ?? block.getEnd() - 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return contexts;
}

function gapFor(marker: LineComment, source: TypeScript.SourceFile, contexts: readonly StatementContext[]): Gap | undefined {
  const matches: Gap[] = [];
  for (const context of contexts) {
    for (let index = 0; index <= context.statements.length; index++) {
      const left = index === 0 ? context.pos : context.statements[index - 1]!.end;
      const right = index === context.statements.length ? context.end : context.statements[index]!.getStart(source);
      if (marker.pos >= left && marker.end <= right) matches.push({ context, index });
    }
  }
  return matches.sort((left, right) => (left.context.end - left.context.pos) - (right.context.end - right.context.pos))[0];
}

/** Invalid begins are still pushed, so their end cannot consume an outer region. */
function regionPairs(starts: readonly StartMarker[], comments: readonly LineComment[], path: string, findings: Finding[]): readonly RegionPair[] {
  const byPosition = new Map(starts.filter(start => start.family === 'begin').map(start => [start.pos, start]));
  const boundaries = comments.filter(comment => comment.family === 'begin' || comment.family === 'end').sort((left, right) => left.pos - right.pos);
  const stack: { marker: StartMarker; invalid: boolean }[] = [];
  const pairs: RegionPair[] = [];
  for (const boundary of boundaries) {
    if (boundary.family === 'begin') {
      const marker = byPosition.get(boundary.pos);
      const invalid = marker === undefined || !marker.valid || !boundary.ownLine;
      const entry = { marker: marker ?? { ...boundary, family: 'begin' as const, valid: false, contracts: [], blockEnd: boundary.end }, invalid };
      if (stack.length > 0) {
        addFinding(findings, 'NestedCodeRegion', path, 'Code regions may not be nested or crossed', boundary.line);
        entry.invalid = true;
        stack[stack.length - 1]!.invalid = true;
      }
      stack.push(entry);
      continue;
    }
    if (stack.length === 0) {
      addFinding(findings, 'OrphanCodeEnd', path, '@concord-end has no open region', boundary.line);
      continue;
    }
    const open = stack.pop()!;
    if (open.invalid || !boundary.ownLine || boundary.argument !== undefined || !open.marker.valid) continue;
    pairs.push({ begin: open.marker, end: boundary });
  }
  for (const open of stack) addFinding(findings, 'UnclosedCodeRegion', path, '@concord-begin has no matching end', open.marker.line);
  return pairs;
}

function boundaryNodes(source: TypeScript.SourceFile): readonly TypeScript.Node[] {
  const nodes: TypeScript.Node[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (ts.isStatement(node) || ts.isClassElement(node) || ts.isObjectLiteralElementLike(node) || ts.isTypeElement(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return nodes;
}

function attachedBoundary(marker: StartMarker, source: TypeScript.SourceFile, nodes: readonly TypeScript.Node[]): TypeScript.Node | undefined {
  const candidates = nodes.filter(node => {
    const start = node.getStart(source);
    return marker.pos >= node.getFullStart() && marker.blockEnd <= start;
  }).sort((left, right) => left.getStart(source) - right.getStart(source) || (left.end - left.pos) - (right.end - right.pos));
  return candidates[0];
}

function staticName(node: TypeScript.Node): string | null {
  const name = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)
    ? node.name
    : ts.isVariableDeclaration(node)
      ? node.name
      : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0]!.name
        : undefined;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function supportedNode(node: TypeScript.Node): { readonly symbol?: string } | undefined {
  if (ts.isFunctionDeclaration(node)) return node.body === undefined ? undefined : (staticName(node) === null ? {} : { symbol: staticName(node)! });
  if (ts.isClassDeclaration(node)) return staticName(node) === null ? {} : { symbol: staticName(node)! };
  if (ts.isMethodDeclaration(node)) return node.body === undefined ? undefined : (staticName(node) === null ? {} : { symbol: staticName(node)! });
  if (!ts.isVariableStatement(node) || node.declarationList.declarations.length !== 1) return undefined;
  const declaration = node.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer))) return undefined;
  return { symbol: declaration.name.text };
}

function directChildren(node: TypeScript.Node): readonly TypeScript.Node[] {
  const children: TypeScript.Node[] = [];
  // Do not return the recursive result from this callback: TypeScript treats a truthy return as early termination.
  ts.forEachChild(node, child => { children.push(child); });
  return children;
}

function locatorPart(node: TypeScript.Node, siblings: readonly TypeScript.Node[], index: number): LocatorPart {
  const kind = ts.SyntaxKind[node.kind] ?? String(node.kind);
  const name = staticName(node);
  const siblingOrdinal = siblings.slice(0, index).filter(candidate => {
    const candidateKind = ts.SyntaxKind[candidate.kind] ?? String(candidate.kind);
    return candidateKind === kind && staticName(candidate) === name;
  }).length;
  return [kind, name, siblingOrdinal];
}

function locatorFor(source: TypeScript.SourceFile, target: TypeScript.Node): Locator {
  const find = (parent: TypeScript.Node): Locator | undefined => {
    const children = directChildren(parent);
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      const part = locatorPart(child, children, index);
      if (child === target) return [part];
      const nested = find(child);
      if (nested !== undefined) return [part, ...nested];
    }
    return undefined;
  };
  return find(source) ?? [];
}

function codeId(relativePath: string, scope: CodeDeclaration['scope'], locator: unknown): string {
  const input = JSON.stringify(['concord.code-reference/v1', relativePath, scope, locator]);
  return `code-${createHash('sha256').update(input).digest('hex').slice(0, 32)}`;
}

function parseSource(input: Source): { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] } {
  const source = ts.createSourceFile(input.path, input.text, ts.ScriptTarget.Latest, true);
  const parseDiagnostics = (source as TypeScript.SourceFile & { readonly parseDiagnostics: readonly TypeScript.Diagnostic[] }).parseDiagnostics;
  const findings: Finding[] = [];
  const comments = actualLineComments(source);
  for (const comment of comments) {
    if (!CODE_FAMILIES.has(comment.family) && !OTHER_FAMILIES.has(comment.family)) addFinding(findings, 'UnknownConcordAnnotation', input.path, `Unknown annotation family @concord-${comment.family}`, comment.line);
    if (['file', 'code', 'begin', 'end'].includes(comment.family) && (comment.argument !== undefined || !comment.ownLine)) addFinding(findings, 'InvalidCodeAnnotation', input.path, `@concord-${comment.family} must be a standalone marker without a parameter`, comment.line);
  }
  const hasCodeMarker = comments.some(comment => CODE_FAMILIES.has(comment.family));
  if (hasCodeMarker && parseDiagnostics.length > 0) {
    for (const diagnostic of parseDiagnostics) addFinding(findings, 'CodeParseError', input.path, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), diagnostic.start === undefined ? undefined : lineAt(source, diagnostic.start));
    return { codes: [], findings };
  }
  const prepared = startMarkers(comments, input.path, findings);
  for (const comment of comments) {
    if (comment.family === 'implements' && !prepared.consumedImplements.has(comment.pos)) addFinding(findings, 'OrphanCodeImplements', input.path, '@concord-implements is not immediately owned by a starting code marker', comment.line);
  }
  const declarations: CodeDeclaration[] = [];
  const allFileMarkers = prepared.starts.filter(start => start.family === 'file');
  const fileMarkers = allFileMarkers.filter(start => start.valid);
  if (fileMarkers.length > 1) for (const marker of fileMarkers.slice(1)) addFinding(findings, 'DuplicateFileCode', input.path, 'A source file may have at most one @concord-file declaration', marker.line);
  if (fileMarkers.length === 1 && allFileMarkers.length === 1) {
    const marker = fileMarkers[0]!;
    const firstStatement = source.statements[0];
    if (firstStatement !== undefined && marker.pos >= firstStatement.getStart(source)) addFinding(findings, 'OrphanCodeAnnotation', input.path, '@concord-file must appear before the first statement', marker.line);
    else declarations.push(decode(CodeDeclarationSchema, { id: codeId(input.path, 'file', []), file: input.path, line: 1, endLine: lineAt(source, input.text.length), scope: 'file', contracts: marker.contracts }, `${input.path}:${marker.line}`));
  }

  const contexts = statementContexts(source);
  const regionCandidates: RegionCandidate[] = [];
  for (const pair of regionPairs(prepared.starts, comments, input.path, findings)) {
    const beginGap = gapFor(pair.begin, source, contexts);
    const endGap = gapFor(pair.end, source, contexts);
    if (beginGap === undefined || endGap === undefined || beginGap.context.node !== endGap.context.node) {
      addFinding(findings, 'CodeRegionBoundary', input.path, 'A code region must begin and end at gaps in the same statement list', pair.begin.line);
      continue;
    }
    if (endGap.index <= beginGap.index) {
      addFinding(findings, 'EmptyCodeRegion', input.path, 'A code region must contain one or more complete consecutive statements', pair.begin.line);
      continue;
    }
    const statements = beginGap.context.statements.slice(beginGap.index, endGap.index);
    const first = statements[0], last = statements.at(-1);
    if (first === undefined || last === undefined) {
      addFinding(findings, 'EmptyCodeRegion', input.path, 'A code region must contain one or more complete consecutive statements', pair.begin.line);
      continue;
    }
    regionCandidates.push({ pair, context: beginGap.context, first, last });
  }
  const validRegionOrdinals = new Map<RegionCandidate, number>();
  for (const context of contexts) {
    const candidates = regionCandidates.filter(candidate => candidate.context === context).sort((left, right) => left.pair.begin.pos - right.pair.begin.pos);
    candidates.forEach((candidate, ordinal) => validRegionOrdinals.set(candidate, ordinal));
  }
  for (const candidate of regionCandidates) {
    const locator = [locatorFor(source, candidate.context.node), validRegionOrdinals.get(candidate)!];
    declarations.push(decode(CodeDeclarationSchema, {
      id: codeId(input.path, 'region', locator), file: input.path,
      line: lineAt(source, candidate.first.getStart(source)), endLine: lineAt(source, Math.max(candidate.first.getStart(source), candidate.last.getEnd() - 1)),
      scope: 'region', contracts: candidate.pair.begin.contracts,
    }, `${input.path}:${candidate.pair.begin.line}`));
  }

  const nodes = boundaryNodes(source);
  const nodeGroups = new Map<TypeScript.Node, StartMarker[]>();
  const validCodeStarts = new Set(prepared.starts.filter(start => start.family === 'code' && start.valid).map(start => start.pos));
  for (const marker of prepared.starts.filter(start => start.family === 'code' && start.valid)) {
    const node = attachedBoundary(marker, source, nodes);
    if (node === undefined) {
      addFinding(findings, 'OrphanCodeAnnotation', input.path, '@concord-code is not attached to the immediately following AST node', marker.line);
      continue;
    }
    const intervening = comments.filter(comment => comment.pos > marker.pos && comment.pos < node.getStart(source) && (comment.family === 'file' || comment.family === 'code' || comment.family === 'begin' || comment.family === 'end'));
    if (intervening.length > 0 && !intervening.every(comment => comment.family === 'code' && validCodeStarts.has(comment.pos) && attachedBoundary(prepared.starts.find(start => start.pos === comment.pos)!, source, nodes) === node)) {
      addFinding(findings, 'CodeMarkerCrossed', input.path, '@concord-code may not bind across another code marker', marker.line);
      continue;
    }
    const group = nodeGroups.get(node) ?? [];
    group.push(marker);
    nodeGroups.set(node, group);
  }
  for (const [node, markers] of nodeGroups) {
    if (markers.length > 1) {
      for (const marker of markers.slice(1)) addFinding(findings, 'DuplicateNodeCode', input.path, 'An AST node may have at most one @concord-code declaration', marker.line);
      continue;
    }
    const marker = markers[0]!;
    const supported = supportedNode(node);
    if (supported === undefined) {
      addFinding(findings, 'UnsupportedCodeNode', input.path, '@concord-code supports body-bearing function, class and method declarations, or a single identifier variable initialized directly with a function', marker.line);
      continue;
    }
    declarations.push(decode(CodeDeclarationSchema, {
      id: codeId(input.path, 'node', locatorFor(source, node)), file: input.path,
      line: lineAt(source, node.getStart(source)), endLine: lineAt(source, Math.max(node.getStart(source), node.getEnd() - 1)),
      scope: 'node', ...(supported.symbol === undefined ? {} : { symbol: supported.symbol }), contracts: marker.contracts,
    }, `${input.path}:${marker.line}`));
  }
  return { codes: declarations, findings };
}

function sourceRoots(repo: Repository): readonly string[] {
  const config: Repository['config'] & { readonly sourceRoots?: readonly string[] } = repo.config;
  return [...new Set(config.sourceRoots ?? [])].sort();
}

function readSources(repo: Repository): readonly Source[] {
  const paths = [...new Set(sourceRoots(repo).flatMap(root => {
    repo.absolute(root);
    return repo.files(root);
  }))].filter(path => SOURCE_EXTENSION.test(path)).sort();
  return paths.map(path => {
    repo.absolute(path);
    const text = repo.read(path);
    if (text === undefined) throw new CodeSourceReadChanged(`Code source changed while reading ${path}`);
    return { path, text, digest: digest(text) };
  });
}

function sameSources(left: readonly Source[], right: readonly Source[]): boolean {
  return left.length === right.length && left.every((source, index) => source.path === right[index]?.path && source.digest === right[index]?.digest);
}

function parserVersion(): string { return `typescript-ast/${typescriptPackageVersion()}/concord-code-parse/v1`; }
const codeContentCache = new ContentCache<ParsedFile>('code_parse', parserVersion(), Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema), findings: Schema.Array(FindingSchema) }));
function fileKey(repo: Repository, source: Source): string {
  return objectDigest({ projectId: repo.config.projectId, root: repo.root, privateDir: repo.privateDir, parser: parserVersion(), path: source.path, sourceDigest: source.digest });
}
function encodeParse(parsed: ParsedFile): string {
  return canonical({ codes: parsed.codes, findings: parsed.findings, digest: objectDigest({ codes: parsed.codes, findings: parsed.findings }) });
}
function decodeParse(payload: string): ParsedFile | undefined {
  try {
    const value = decode(CodeParseSchema, JSON.parse(payload), 'code cache');
    if (value.digest !== objectDigest({ codes: value.codes, findings: value.findings })) return undefined;
    return { codes: value.codes, findings: value.findings };
  } catch { return undefined; }
}
function mergeParsed(parsed: readonly ParsedFile[]): { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] } {
  const codes = parsed.flatMap(item => item.codes).sort((left, right) => left.id.localeCompare(right.id) || left.file.localeCompare(right.file) || left.line - right.line);
  const findings = parsed.flatMap(item => item.findings);
  const ids = new Map<string, CodeDeclaration>();
  for (const item of codes) {
    const prior = ids.get(item.id);
    if (prior === undefined) ids.set(item.id, item);
    else addFinding(findings, 'DuplicateCodeId', item.file, `Code reference ${item.id} is also declared at ${prior.file}:${prior.line}`, item.line);
  }
  return { codes, findings };
}
function compileCached(repo: Repository, current: readonly Source[], mode: CodeMode, skipCache: boolean): CompiledFiles {
  if (mode === 'off' || skipCache) {
    const inputs = current.map(source => ({ path: source.path, source: source.text }));
    return { ...mergeParsed(codeContentCache.getMany(inputs, input => input.source.includes('@concord-') ? parseSource({ path: input.path, text: input.source, digest: digest(input.source) }) : { codes: [], findings: [] })), hits: 0, misses: current.length, rows: [] };
  }
  let stored = new Map<string, string>();
  let readFailure: string | undefined;
  if (mode === 'use') {
    try { stored = new Map(readCodePayloads(repo, current.map(source => fileKey(repo, source)))); }
    catch (cause) { readFailure = cause instanceof Error ? cause.message : String(cause); }
  }
  const parsed: ParsedFile[] = [];
  const rows: { key: string; payload: string }[] = [];
  let hits = 0;
  let misses = 0;
  const missesToParse: Source[] = [];
  const pending: { index: number; key: string }[] = [];
  for (const source of current) {
    const key = fileKey(repo, source);
    if (mode === 'use' && readFailure === undefined && stored.has(key)) {
      const decoded = decodeParse(stored.get(key)!);
      if (decoded !== undefined) { hits += 1; parsed.push(decoded); continue; }
    }
    misses += 1;
    pending.push({ index: parsed.length, key });
    missesToParse.push(source);
    parsed.push({ codes: [], findings: [] });
  }
  const freshValues = codeContentCache.getMany(missesToParse.map(source => ({ path: source.path, source: source.text })), input => input.source.includes('@concord-') ? parseSource({ path: input.path, text: input.source, digest: digest(input.source) }) : { codes: [], findings: [] });
  for (let index = 0; index < pending.length; index++) {
    const item = pending[index]!;
    const fresh = freshValues[index]!;
    parsed[item.index] = fresh;
    if (readFailure === undefined) rows.push({ key: item.key, payload: encodeParse(fresh) });
  }
  return { ...mergeParsed(parsed), hits, misses, rows, ...(readFailure === undefined ? {} : { readFailure }) };
}

function result(compiled: { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] }, current: readonly Source[], changed: boolean): Omit<CodeSnapshot, 'cache'> {
  const findings = [...compiled.findings];
  if (changed) addFinding(findings, 'CodeSourceChanged', '.', 'Code source paths or contents changed while they were scanned');
  findings.sort((left, right) => left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0) || left.code.localeCompare(right.code));
  const files = current.map(source => ({ path: source.path, digest: source.digest }));
  const value = { codes: compiled.codes, findings, files, digest: objectDigest({ codes: compiled.codes, findings, files }) };
  return decode(CodeSnapshotSchema, value, 'code scan');
}
function withCache(body: Omit<CodeSnapshot, 'cache'>, cache: CodeCacheStatus): CodeSnapshot { return { ...body, cache }; }
function finish(repo: Repository, compiled: CompiledFiles, current: readonly Source[], changed: boolean, mode: CodeMode, cachePath: string): CodeSnapshot {
  const body = result(compiled, current, changed);
  if (changed) return withCache(body, { status: 'source-changed', hits: 0, misses: compiled.misses, path: cachePath });
  if (mode === 'off') return withCache(body, { status: 'off', hits: 0, misses: compiled.misses, path: cachePath });
  if (compiled.readFailure !== undefined) return withCache(body, { status: 'unavailable', hits: 0, misses: compiled.misses, path: cachePath, detail: compiled.readFailure });
  try {
    persistNotedConfig(repo);
    if (compiled.rows.length > 0) writeCodePayloads(repo, compiled.rows);
  } catch (cause) {
    return withCache(body, { status: 'unavailable', hits: compiled.hits, misses: compiled.misses, path: cachePath, detail: cause instanceof Error ? cause.message : String(cause) });
  }
  const status = compiled.misses === 0 ? 'hit' : compiled.hits === 0 ? 'miss' : 'partial';
  return withCache(body, { status, hits: compiled.hits, misses: compiled.misses, path: cachePath });
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
export function scanCode(repo: Repository, options: { cache?: CodeMode } = {}): CodeSnapshot {
  return repo.snapshot === undefined ? scanCodeUnderSnapshot(repo, options) : repo.snapshot(() => scanCodeUnderSnapshot(repo, options));
}
function scanCodeUnderSnapshot(repo: Repository, options: { cache?: CodeMode }): CodeSnapshot {
  const mode = options.cache ?? 'use';
  const cachePath = cacheDatabasePath(repo.privateDir);
  let before: readonly Source[];
  let changed = false;
  try { before = readSources(repo); }
  catch (cause) { if (cause instanceof CodeSourceReadChanged) { before = []; changed = true; } else throw cause; }
  const initial = compileCached(repo, before, mode, changed);
  let after: readonly Source[];
  try { after = readSources(repo); }
  catch (cause) { if (cause instanceof CodeSourceReadChanged) return finish(repo, { codes: [], findings: [], hits: 0, misses: 0, rows: [] }, [], true, mode, cachePath); else throw cause; }
  if (sameSources(before, after)) return finish(repo, initial, before, changed, mode, cachePath);
  const fresh = compileCached(repo, after, mode, true);
  try {
    const stable = readSources(repo);
    return sameSources(after, stable) ? finish(repo, fresh, after, true, mode, cachePath) : finish(repo, { codes: [], findings: [], hits: 0, misses: 0, rows: [] }, stable, true, mode, cachePath);
  } catch (cause) {
    if (cause instanceof CodeSourceReadChanged) return finish(repo, { codes: [], findings: [], hits: 0, misses: 0, rows: [] }, [], true, mode, cachePath);
    throw cause;
  }
}
