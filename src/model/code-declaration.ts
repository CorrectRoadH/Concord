import { Schema } from "effect";
import { Slug, Text } from "./shared.js";


// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md#声明规则
export const CodeDeclarationSchema = Schema.Struct({
  id: Slug,
  file: Text,
  line: Schema.Int,
  endLine: Schema.Int,
  scope: Schema.Literals(['file', 'node', 'region']),
  symbol: Schema.optional(Text),
  contracts: Schema.Array(Text),
});

// @concord-end
export type CodeDeclaration = {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly endLine: number;
  readonly scope: 'file' | 'node' | 'region';
  readonly symbol?: string;
  readonly contracts: readonly string[];
};
