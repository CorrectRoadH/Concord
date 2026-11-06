import { createHash } from 'node:crypto';
import { SyntaxKind } from 'typescript/ast';
import { createScanner } from 'typescript/ast/scanner';

export const webHash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Length-independent, ordered content identity; timestamps and checkout location do not participate. */
export function sourceWebInputDigest(files: ReadonlyMap<string, Uint8Array>): string {
  return webHash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => [name, webHash(bytes)])));
}

/** Lex only: workspace services never start TypeScript or load a bundler to find inputs. */
export function sourceWebRuntimeImports(source: string): readonly string[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: { kind: SyntaxKind; value: string }[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    // JSX/template text can be invalid as standalone TS tokens (for example a
    // bare #). The standalone scanner then returns a zero-width token.
    if (scanner.getTokenEnd() <= scanner.getTokenStart()) { scanner.resetTokenState(scanner.getTokenStart() + 1); continue; }
    tokens.push({ kind, value: scanner.getTokenValue() });
  }
  const imports = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const kind = tokens[i]!.kind;
    if (kind !== SyntaxKind.ImportKeyword && kind !== SyntaxKind.ExportKeyword) continue;
    const next = tokens[i + 1];
    if (!next || next.kind === SyntaxKind.TypeKeyword || next.kind === SyntaxKind.DotToken) continue;
    if (next.kind === SyntaxKind.StringLiteral) { imports.add(next.value); continue; }
    if (next.kind === SyntaxKind.OpenParenToken) {
      if (tokens[i + 2]?.kind === SyntaxKind.StringLiteral) imports.add(tokens[i + 2]!.value);
      continue;
    }
    // Named clauses can contain exclusively erased bindings: import { type A }.
    let j = i + 1, runtime = next.kind !== SyntaxKind.OpenBraceToken;
    if (next.kind === SyntaxKind.OpenBraceToken) {
      j++;
      while (j < tokens.length && tokens[j]!.kind !== SyntaxKind.CloseBraceToken) {
        if (tokens[j]!.kind !== SyntaxKind.TypeKeyword) runtime = true;
        while (j < tokens.length && tokens[j]!.kind !== SyntaxKind.CommaToken && tokens[j]!.kind !== SyntaxKind.CloseBraceToken) j++;
        if (tokens[j]?.kind === SyntaxKind.CommaToken) j++;
      }
      j++;
    }
    // Only import/export declarations with `from`; never scan into function bodies.
    while (j < tokens.length && ![SyntaxKind.FromKeyword, SyntaxKind.SemicolonToken, SyntaxKind.OpenBraceToken, SyntaxKind.EqualsToken].includes(tokens[j]!.kind)) {
      if (j > i + 1 && [SyntaxKind.ImportKeyword, SyntaxKind.ExportKeyword].includes(tokens[j]!.kind)) break;
      j++;
    }
    if (runtime && tokens[j]?.kind === SyntaxKind.FromKeyword && tokens[j + 1]?.kind === SyntaxKind.StringLiteral) imports.add(tokens[j + 1]!.value);
  }
  return [...imports];
}
