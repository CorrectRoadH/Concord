// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md#验收
import { relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Schema } from 'effect';
import { ConcordError, decode, type Repository } from './shared.js';
import type { LanguageServer } from './language-server-config.js';
import type { CodeDeclaration } from './code.js';

const nat = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PositionSchema = Schema.Struct({ line: nat, character: nat });
export const RangeSchema = Schema.Struct({ start: PositionSchema, end: PositionSchema });
export type Position = typeof PositionSchema.Type;
export type Range = typeof RangeSchema.Type;
export type PositionEncoding = 'utf-16' | 'utf-8' | 'utf-32';
export interface DocumentSymbol {
  readonly name: string; readonly detail?: string; readonly kind: number; readonly tags?: readonly number[];
  readonly deprecated?: boolean; readonly range: Range; readonly selectionRange: Range; readonly children?: readonly DocumentSymbol[];
}
const SymbolSchema: Schema.Codec<DocumentSymbol> = Schema.Struct({
  name: Schema.String, detail: Schema.optional(Schema.String), kind: nat, tags: Schema.optional(Schema.Array(nat)), deprecated: Schema.optional(Schema.Boolean),
  range: RangeSchema, selectionRange: RangeSchema, children: Schema.optional(Schema.Array(Schema.suspend(() => SymbolSchema))),
});
const FlatSchema = Schema.Struct({ name: Schema.String, kind: nat, tags: Schema.optional(Schema.Array(nat)), deprecated: Schema.optional(Schema.Boolean), location: Schema.Struct({ uri: Schema.String, range: RangeSchema }), containerName: Schema.optional(Schema.String) });
export const SymbolLocatorSchema = Schema.Struct({ path: Schema.String, range: RangeSchema, selectionRange: RangeSchema, name: Schema.String, kind: nat, profile: Schema.String });
export type SymbolLocator = typeof SymbolLocatorSchema.Type;
export const CallItemSchema = Schema.Struct({ name: Schema.String, kind: nat, tags: Schema.optional(Schema.Array(nat)), detail: Schema.optional(Schema.String), uri: Schema.String, range: RangeSchema, selectionRange: RangeSchema, data: Schema.optional(Schema.Unknown) });
export type CallItem = typeof CallItemSchema.Type;
export const OutgoingSchema = Schema.NullOr(Schema.Array(Schema.Struct({ to: CallItemSchema, fromRanges: Schema.Array(RangeSchema) })));
export const PrepareSchema = Schema.NullOr(Schema.Array(CallItemSchema));

export function sourceUri(repo: Repository, path: string): string { return pathToFileURL(repo.absolute(path)).href; }
export function uriPath(repo: Repository, uri: string): string;
export function uriPath(repo: Repository, uri: string, allowExternal: true): string | undefined;
export function uriPath(repo: Repository, uri: string, allowExternal = false): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== '' || url.hash !== '') throw new Error('not a local file URI');
    const path = relative(repo.root, fileURLToPath(url)).split(sep).join('/');
    if (path.startsWith('../') || path === '..') {
      if (allowExternal) return undefined;
      throw new Error('URI escapes the repository');
    }
    if (path === '') throw new Error('URI is not a source file');
    repo.absolute(path);
    return path;
  } catch { throw new ConcordError('LanguageServerFailed', 'Server returned an unsafe file URI'); }
}
export function positionOffset(text: string, position: Position, encoding: PositionEncoding): number {
  const lines = text.split('\n');
  const line = lines[position.line]?.replace(/\r$/u, '');
  if (line === undefined) throw new ConcordError('UnsupportedSymbolBinding', 'Symbol line is outside the current document');
  let units = 0, characters = 0;
  for (const point of line) {
    if (units === position.character) break;
    units += encoding === 'utf-8' ? Buffer.byteLength(point) : encoding === 'utf-32' ? 1 : point.length;
    characters += point.length;
  }
  if (units !== position.character) throw new ConcordError('UnsupportedSymbolBinding', 'Symbol character is outside the document or splits a code point');
  return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + characters;
}
export function validRange(text: string, range: Range, encoding: PositionEncoding): readonly [number, number] {
  const start = positionOffset(text, range.start, encoding), end = positionOffset(text, range.end, encoding);
  if (end < start) throw new ConcordError('UnsupportedSymbolBinding', 'Symbol range is reversed');
  return [start, end];
}
function contains(outer: readonly [number, number], inner: readonly [number, number]): boolean { return outer[0] <= inner[0] && outer[1] >= inner[1]; }
export function documentSymbols(value: unknown, text: string, encoding: PositionEncoding, limit: number): { symbols: readonly DocumentSymbol[]; gaps: readonly string[] } {
  try {
    const decoded = decode(Schema.NullOr(Schema.Union([Schema.Array(SymbolSchema), Schema.Array(FlatSchema)])), value, 'documentSymbol');
    if (decoded === null) return { symbols: [], gaps: ['UnsupportedSymbolBinding'] };
    if (decoded.some(symbol => 'location' in symbol)) return { symbols: [], gaps: ['UnsupportedSymbolBinding'] };
    const symbols = decoded as readonly DocumentSymbol[];
    let count = 0;
    const visit = (symbol: DocumentSymbol, parent?: readonly [number, number]): void => {
      if (++count > limit) throw new ConcordError('AnalysisBudgetExceeded', 'SymbolLimit');
      const bounds = validRange(text, symbol.range, encoding), selection = validRange(text, symbol.selectionRange, encoding);
      if (!contains(bounds, selection) || parent !== undefined && !contains(parent, bounds)) throw new ConcordError('UnsupportedSymbolBinding', 'Invalid symbol nesting');
      for (const child of symbol.children ?? []) visit(child, bounds);
    };
    for (const symbol of symbols) visit(symbol);
    return { symbols, gaps: [] };
  } catch (cause) {
    if (cause instanceof ConcordError && cause.code === 'AnalysisBudgetExceeded') throw cause;
    return { symbols: [], gaps: ['UnsupportedSymbolBinding'] };
  }
}
export function flattenSymbols(symbols: readonly DocumentSymbol[], depth = 0): readonly { readonly symbol: DocumentSymbol; readonly depth: number }[] {
  return symbols.flatMap(symbol => [{ symbol, depth }, ...flattenSymbols(symbol.children ?? [], depth + 1)]);
}
function markerEnd(text: string, declaration: CodeDeclaration, server: LanguageServer): number {
  const lines = text.split('\n');
  let end = declaration.line;
  while (end < lines.length && server.profile.commentPrefixes.some(prefix => lines[end]!.trimStart().startsWith(prefix) && /^\s*@concord-implements\s/u.test(lines[end]!.trimStart().slice(prefix.length)))) end++;
  return lines.slice(0, end).reduce((sum, line) => sum + line.length + 1, 0);
}
function permittedPrelude(text: string, server: LanguageServer): boolean {
  return text.split('\n').every(line => line.trim() === '' || server.profile.decorators === 'at-line' && /^\s*@[^\r\n]+$/u.test(line) || server.profile.leadingComments && server.profile.commentPrefixes.some(prefix => line.trimStart().startsWith(prefix)));
}
export function bindSymbol(declaration: CodeDeclaration, text: string, symbols: readonly DocumentSymbol[], server: LanguageServer, encoding: PositionEncoding): SymbolLocator | undefined {
  if (declaration.scope !== 'node') return undefined;
  const end = markerEnd(text, declaration, server);
  const candidates = flattenSymbols(symbols).filter(({ symbol }) => server.profile.declarationKinds.includes(symbol.kind)).filter(({ symbol }) => {
    const [start, finish] = validRange(text, symbol.range, encoding);
    if (start >= end) return permittedPrelude(text.slice(end, start), server);
    // Only profiles that include leading comments may bind a marker inside range.
    const markerStart = text.split('\n').slice(0, declaration.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    return server.profile.leadingComments && start <= markerStart && end <= finish && permittedPrelude(text.slice(start, markerStart), server);
  }).sort((left, right) => positionOffset(text, left.symbol.range.start, encoding) - positionOffset(text, right.symbol.range.start, encoding) || right.depth - left.depth);
  const selected = candidates[0];
  if (selected === undefined) return undefined;
  const same = candidates.filter(item => positionOffset(text, item.symbol.range.start, encoding) === positionOffset(text, selected.symbol.range.start, encoding) && item.depth === selected.depth);
  if (same.length !== 1) return undefined;
  return { path: declaration.file, range: selected.symbol.range, selectionRange: selected.symbol.selectionRange, name: selected.symbol.name, kind: selected.symbol.kind, profile: `${server.id}/${server.profile.version}` };
}
