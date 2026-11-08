// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md#数据
import { Schema } from 'effect';

// Decode the fields consumed by the native host without importing Node-only model code.
const Path = Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\u0000]+$/u));
export const ModWorkspaceSnapshot = Schema.Struct({
  root: Schema.String,
  documents: Schema.Array(Schema.Struct({ path: Path, metadata: Schema.Struct({ kind: Schema.String, title: Schema.String, feature: Schema.optional(Schema.String) }) })),
  pages: Schema.Array(Schema.Struct({ path: Path, derivedTitle: Schema.optional(Schema.String) })),
  conceptCatalogs: Schema.Array(Schema.Struct({ path: Path, concepts: Schema.Array(Schema.Struct({ id: Schema.String, term: Schema.String })) })),
  cases: Schema.Array(Schema.Struct({ file: Path, line: Schema.Int, name: Schema.String, contract: Schema.String })),
  codes: Schema.Array(Schema.Struct({ file: Path, line: Schema.Int, symbol: Schema.optional(Schema.String), contracts: Schema.Array(Schema.String) })),
  edges: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String, relation: Schema.String })),
  findings: Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.optional(Schema.Int), message: Schema.String })),
});
export const ModWorkspaceProjection = Schema.Struct({ snapshot: ModWorkspaceSnapshot, projection: Schema.Struct({ sourceDigest: Schema.String, current: Schema.Literal(false) }) });
