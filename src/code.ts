// @concord-file code-ownership-parser
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { Schema } from 'effect';
import * as ts from 'typescript';
import { decode, digest, objectDigest, Slug, Text, type Finding, type Repository } from './shared.js';
import { parseReference } from './refs.js';
import { ContentCache } from './content-cache.js';

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

export interface CodeSnapshot {
  readonly codes: readonly CodeDeclaration[];
  readonly findings: readonly Finding[];
  readonly files: readonly { readonly path: string; readonly digest: string }[];
  readonly digest: string;
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
  readonly id: string;
  readonly contracts: readonly string[];
  readonly blockEnd: number;
}
interface StatementContext { readonly node: ts.Node; readonly statements: readonly ts.Statement[]; readonly pos: number; readonly end: number }
interface Gap { readonly context: StatementContext; readonly index: number }
interface RegionPair { readonly begin: StartMarker; readonly end: LineComment }

class CodeSourceReadChanged extends Error {}

function addFinding(findings: Finding[], code: string, path: string, message: string, line?: number): void {
  findings.push(line === undefined ? { code, path, message } : { code, path, message, line });
}

function lineAt(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(Math.max(0, Math.min(position, source.text.length))).line + 1;
}

function lineBounds(text: string, pos: number, end: number): { readonly ownLine: boolean; readonly end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline < 0 ? text.length : newline;
  return { ownLine: /^\s*$/u.test(text.slice(start, pos)) && /^\s*$/u.test(text.slice(end, lineEnd).replace(/\r$/u, '')), end: newline < 0 ? text.length : newline + 1 };
}

function actualLineComments(source: ts.SourceFile): readonly LineComment[] {
  const ranges = new Map<number, ts.CommentRange>();
  const tokenSpans: { readonly start: number; readonly end: number }[] = [];
  const collect = (items: readonly ts.CommentRange[] | undefined): void => {
    for (const range of items ?? []) if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) ranges.set(range.pos, range);
  };
  const visit = (node: ts.Node): void => {
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

function decodeId(comment: LineComment, path: string, findings: Finding[]): string | undefined {
  if (!comment.ownLine || comment.argument === undefined) {
    addFinding(findings, 'InvalidCodeAnnotation', path, `@concord-${comment.family} must occupy its own line and have one stable ID`, comment.line);
    return undefined;
  }
  try { return decode(Slug, comment.argument, `${path}:${comment.line} code ID`); }
  catch (cause) {
    addFinding(findings, 'InvalidCodeId', path, cause instanceof Error ? cause.message : String(cause), comment.line);
    return undefined;
  }
}

function startMarkers(comments: readonly LineComment[], path: string, findings: Finding[]): { readonly starts: readonly StartMarker[]; readonly consumedImplements: ReadonlySet<number> } {
  const byLine = new Map(comments.map(comment => [comment.line, comment]));
  const consumed = new Set<number>();
  const starts: StartMarker[] = [];
  for (const comment of comments) {
    if (comment.family !== 'file' && comment.family !== 'code' && comment.family !== 'begin') continue;
    const id = decodeId(comment, path, findings);
    const implementations: LineComment[] = [];
    for (let line = comment.line + 1;; line++) {
      const next = byLine.get(line);
      if (next === undefined || next.family !== 'implements' || !next.ownLine) break;
      implementations.push(next);
      consumed.add(next.pos);
    }
    if (implementations.length === 0) addFinding(findings, 'MissingCodeContract', path, `@concord-${comment.family} ${comment.argument ?? ''} must be followed immediately by at least one @concord-implements`, comment.line);
    const contracts: string[] = [];
    let valid = id !== undefined && implementations.length > 0;
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
    if (valid && id !== undefined) starts.push({ ...comment, family: comment.family, id, contracts, blockEnd: implementations.at(-1)?.end ?? comment.end });
  }
  return { starts, consumedImplements: consumed };
}

function statementContexts(source: ts.SourceFile): readonly StatementContext[] {
  const contexts: StatementContext[] = [];
  const add = (node: ts.Node, statements: ts.NodeArray<ts.Statement>, end: number): void => {
    contexts.push({ node, statements: [...statements], pos: statements.pos, end });
  };
  const visit = (node: ts.Node): void => {
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

function gapFor(marker: LineComment, source: ts.SourceFile, contexts: readonly StatementContext[]): Gap | undefined {
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

function regionPairs(starts: readonly StartMarker[], comments: readonly LineComment[], path: string, findings: Finding[]): readonly RegionPair[] {
  const valid = new Map(starts.filter(start => start.family === 'begin').map(start => [start.pos, start]));
  const boundaries = comments.filter(comment => comment.family === 'begin' || comment.family === 'end').sort((left, right) => left.pos - right.pos);
  const stack: StartMarker[] = [];
  const invalid = new Set<number>();
  const pairs: RegionPair[] = [];
  for (const boundary of boundaries) {
    if (boundary.family === 'begin') {
      const begin = valid.get(boundary.pos);
      if (begin === undefined) continue;
      if (stack.length > 0) {
        addFinding(findings, 'NestedCodeRegion', path, 'Code regions may not be nested or crossed', begin.line);
        for (const open of stack) invalid.add(open.pos);
        invalid.add(begin.pos);
      }
      stack.push(begin);
      continue;
    }
    const endId = decodeId(boundary, path, findings);
    if (stack.length === 0) {
      addFinding(findings, 'OrphanCodeEnd', path, '@concord-end has no open region', boundary.line);
      continue;
    }
    const begin = stack.pop()!;
    if (endId === undefined || endId !== begin.id) {
      addFinding(findings, 'MismatchedCodeRegion', path, `Expected @concord-end ${begin.id}`, boundary.line);
      invalid.add(begin.pos);
      continue;
    }
    if (!invalid.has(begin.pos)) pairs.push({ begin, end: boundary });
  }
  for (const begin of stack) addFinding(findings, 'UnclosedCodeRegion', path, `@concord-begin ${begin.id} has no matching end`, begin.line);
  return pairs;
}

function boundaryNodes(source: ts.SourceFile): readonly ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node) || ts.isClassElement(node) || ts.isObjectLiteralElementLike(node) || ts.isTypeElement(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return nodes;
}

function attachedBoundary(marker: StartMarker, source: ts.SourceFile, nodes: readonly ts.Node[]): ts.Node | undefined {
  const candidates = nodes.filter(node => {
    const start = node.getStart(source);
    return marker.pos >= node.getFullStart() && marker.blockEnd <= start;
  }).sort((left, right) => left.getStart(source) - right.getStart(source) || (left.end - left.pos) - (right.end - right.pos));
  return candidates[0];
}

function supportedNode(node: ts.Node): { readonly symbol?: string } | undefined {
  if (ts.isFunctionDeclaration(node)) return node.body === undefined ? undefined : node.name === undefined ? {} : { symbol: node.name.text };
  if (ts.isClassDeclaration(node)) return node.name === undefined ? {} : { symbol: node.name.text };
  if (ts.isMethodDeclaration(node)) {
    if (node.body === undefined) return undefined;
    return { symbol: node.name.getText() };
  }
  if (!ts.isVariableStatement(node) || node.declarationList.declarations.length !== 1) return undefined;
  const declaration = node.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer))) return undefined;
  return { symbol: declaration.name.text };
}

function parseSource(input: Source): { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] } {
  const source = ts.createSourceFile(input.path, input.text, ts.ScriptTarget.Latest, true);
  const parseDiagnostics = (source as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  const findings: Finding[] = [];
  const comments = actualLineComments(source);
  for (const comment of comments) {
    if (!CODE_FAMILIES.has(comment.family) && !OTHER_FAMILIES.has(comment.family)) addFinding(findings, 'UnknownConcordAnnotation', input.path, `Unknown annotation family @concord-${comment.family}`, comment.line);
  }
  const hasCodeMarker = comments.some(comment => CODE_FAMILIES.has(comment.family));
  if (hasCodeMarker && parseDiagnostics.length > 0) {
    for (const diagnostic of parseDiagnostics) {
      addFinding(findings, 'CodeParseError', input.path, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), diagnostic.start === undefined ? undefined : lineAt(source, diagnostic.start));
    }
    return { codes: [], findings };
  }
  const prepared = startMarkers(comments, input.path, findings);
  for (const comment of comments) {
    if (comment.family === 'implements' && !prepared.consumedImplements.has(comment.pos)) addFinding(findings, 'OrphanCodeImplements', input.path, '@concord-implements is not immediately owned by a starting code marker', comment.line);
  }
  const declarations: CodeDeclaration[] = [];
  const fileMarkers = prepared.starts.filter(start => start.family === 'file');
  if (fileMarkers.length > 1) for (const marker of fileMarkers.slice(1)) addFinding(findings, 'DuplicateFileCode', input.path, 'A source file may have at most one @concord-file declaration', marker.line);
  if (fileMarkers.length === 1) {
    const marker = fileMarkers[0]!;
    const firstStatement = source.statements[0];
    if (firstStatement !== undefined && marker.pos >= firstStatement.getStart(source)) addFinding(findings, 'OrphanCodeAnnotation', input.path, '@concord-file must appear before the first statement', marker.line);
    else {
      const value = { id: marker.id, file: input.path, line: 1, endLine: lineAt(source, input.text.length), scope: 'file' as const, contracts: marker.contracts };
      declarations.push(decode(CodeDeclarationSchema, value, `${input.path}:${marker.line}`));
    }
  }
  const contexts = statementContexts(source);
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
    declarations.push(decode(CodeDeclarationSchema, { id: pair.begin.id, file: input.path, line: lineAt(source, first.getStart(source)), endLine: lineAt(source, Math.max(first.getStart(source), last.getEnd() - 1)), scope: 'region', contracts: pair.begin.contracts }, `${input.path}:${pair.begin.line}`));
  }
  const nodes = boundaryNodes(source);
  const nodeGroups = new Map<ts.Node, StartMarker[]>();
  const validCodeStarts = new Set(prepared.starts.filter(start => start.family === 'code').map(start => start.pos));
  for (const marker of prepared.starts.filter(start => start.family === 'code')) {
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
    declarations.push(decode(CodeDeclarationSchema, { id: marker.id, file: input.path, line: lineAt(source, node.getStart(source)), endLine: lineAt(source, Math.max(node.getStart(source), node.getEnd() - 1)), scope: 'node', ...(supported.symbol === undefined ? {} : { symbol: supported.symbol }), contracts: marker.contracts }, `${input.path}:${marker.line}`));
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

const codeContentCache = new ContentCache<ReturnType<typeof parseSource>>();

function compile(current: readonly Source[]): { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] } {
  const parsed = current.map(source => codeContentCache.get(source.path, source.text, () => parseSource(source)));
  const codes = parsed.flatMap(item => item.codes).sort((left, right) => left.id.localeCompare(right.id) || left.file.localeCompare(right.file) || left.line - right.line);
  const findings = parsed.flatMap(item => item.findings);
  const ids = new Map<string, CodeDeclaration>();
  for (const item of codes) {
    const prior = ids.get(item.id);
    if (prior === undefined) ids.set(item.id, item);
    else addFinding(findings, 'DuplicateCodeId', item.file, `Code ID ${item.id} is also declared at ${prior.file}:${prior.line}`, item.line);
  }
  return { codes, findings };
}

function result(compiled: { readonly codes: readonly CodeDeclaration[]; readonly findings: readonly Finding[] }, current: readonly Source[], changed: boolean): CodeSnapshot {
  const findings = [...compiled.findings];
  if (changed) addFinding(findings, 'CodeSourceChanged', '.', 'Code source paths or contents changed while they were scanned');
  findings.sort((left, right) => left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0) || left.code.localeCompare(right.code));
  const files = current.map(source => ({ path: source.path, digest: source.digest }));
  const value = { codes: compiled.codes, findings, files, digest: objectDigest({ codes: compiled.codes, findings, files }) };
  return decode(CodeSnapshotSchema, value, 'code scan');
}

// @concord-code scan-code-ownership
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
export function scanCode(repo: Repository): CodeSnapshot {
  let before: readonly Source[];
  let changed = false;
  try { before = readSources(repo); }
  catch (cause) { if (cause instanceof CodeSourceReadChanged) { before = []; changed = true; } else throw cause; }
  const initial = compile(before);
  let after: readonly Source[];
  try { after = readSources(repo); }
  catch (cause) { if (cause instanceof CodeSourceReadChanged) return result({ codes: [], findings: [] }, [], true); throw cause; }
  if (sameSources(before, after)) return result(initial, before, changed);
  const fresh = compile(after);
  try {
    const stable = readSources(repo);
    return sameSources(after, stable) ? result(fresh, after, true) : result({ codes: [], findings: [] }, stable, true);
  } catch (cause) {
    if (cause instanceof CodeSourceReadChanged) return result({ codes: [], findings: [] }, [], true);
    throw cause;
  }
}
