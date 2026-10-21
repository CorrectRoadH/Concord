// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
import { Schema } from 'effect';
import { Text } from './shared.js';

/**
 * Shared shape for disposable observations: native test manifests, language analysis and relevance.
 * Observations live only in HawDB projections. `check` never reads them; see
 * docs/design/test-journey-steps/共同身份.md#观察结果.
 */
export interface Observation<T> {
  readonly value: T;
  /** Digest of every actual input, including implementation and version identities. */
  readonly inputs: string;
  readonly complete: boolean;
  /** Named reasons; non-empty whenever `complete` is false. */
  readonly gaps: readonly string[];
  readonly observedAt: string;
  /** True only when `inputs` matches the current sources. */
  readonly current: boolean;
}

export const observationSchema = <S extends Schema.Top>(value: S) => Schema.Struct({
  value,
  inputs: Text,
  complete: Schema.Boolean,
  gaps: Schema.Array(Text),
  observedAt: Text,
  current: Schema.Boolean,
});

export const RelevanceLevelSchema = Schema.Literals(['step', 'use-case', 'feature']);
export type RelevanceLevel = typeof RelevanceLevelSchema.Type;

/** Relevance reports only what was observed; it never concludes that a test is unrelated. */
export const RelevanceSchema = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal('observed'), level: RelevanceLevelSchema, matched: Schema.Array(Text), gaps: Schema.Array(Text) }),
  Schema.Struct({ verdict: Schema.Literal('not-observed'), gaps: Schema.NonEmptyArray(Text) }),
]);
export type Relevance = typeof RelevanceSchema.Type;

/** Builds an observation and enforces that incomplete results carry at least one named gap. */
export function observation<T>(value: T, inputs: string, gaps: readonly string[], current: boolean, observedAt = new Date().toISOString()): Observation<T> {
  return { value, inputs, complete: gaps.length === 0, gaps: [...new Set(gaps)].sort(), observedAt, current };
}
