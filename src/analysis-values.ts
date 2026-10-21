// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { Schema } from 'effect';
import { observationSchema } from './observation.js';
import { SymbolLocatorSchema } from './lsp-symbols.js';
import { RangeSchema } from './test-adapter-protocol.js';
import { Sha256, Text } from './shared.js';

export const NativeAnalysisScopeSchema = Schema.Struct({
  adapterId: Text, manifestInputs: Sha256, manifestDigest: Sha256,
  bindingVersion: Schema.Literal('concord.native-analysis-binding/v1'), selectionDigest: Sha256,
  nativeIds: Schema.NonEmptyArray(Text),
  ranges: Schema.NonEmptyArray(RangeSchema),
  gaps: Schema.Array(Schema.String),
});
export type NativeAnalysisScope = typeof NativeAnalysisScopeSchema.Type;
export const DependencySchema = Schema.Struct({
  testId: Schema.String, scope: Schema.Literals(['file', 'native-case']), file: Schema.String,
  declarations: Schema.Array(Schema.String),
  edges: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  gaps: Schema.Array(Schema.String),
  native: Schema.optional(NativeAnalysisScopeSchema),
});
export type DependencyObservation = typeof DependencySchema.Type;
export const AnalysisValueSchema = Schema.Struct({
  analyzer: Schema.String, profile: Schema.String, encoding: Schema.Literals(['utf-16', 'utf-8', 'utf-32']),
  locators: Schema.Array(Schema.Struct({ codeId: Schema.String, locator: SymbolLocatorSchema })),
  dependencies: Schema.Array(DependencySchema),
  gaps: Schema.Array(Schema.String),
});
export type AnalysisValue = typeof AnalysisValueSchema.Type;
export const AnalysisObservationSchema = observationSchema(AnalysisValueSchema);
export type AnalysisObservation = typeof AnalysisObservationSchema.Type;
