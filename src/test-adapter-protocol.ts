// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
import { Schema } from 'effect';
import { ConcordError, Nat, Sha256, Text, decode } from './shared.js';

export const ADAPTER_FORMAT = 'concord.test-adapter/v1' as const;
export const ProcessStatusSchema = Schema.Struct({ invocationId: Text, exitCode: Schema.NullOr(Nat), signal: Schema.NullOr(Text), timedOut: Schema.Boolean, cancelled: Schema.Boolean, outputTruncated: Schema.Boolean, cleanup: Schema.Literals(['complete', 'unknown']) });
export type ProcessStatus = typeof ProcessStatusSchema.Type;
export const CompletenessSchema = Schema.Struct({ complete: Schema.Boolean, gaps: Schema.Array(Text) }).check(Schema.makeFilter(value => value.complete || value.gaps.length > 0));
export const CapabilitiesSchema = Schema.Struct({ realCollection: Schema.Boolean, leaf: Schema.Boolean, parameterGroups: Schema.Boolean, exactSelection: Schema.Boolean, perItemReport: Schema.Boolean, range: Schema.Boolean, tags: Schema.Boolean, skipVisibility: Schema.Boolean, rangeTrivia: Schema.Boolean });
export type Capabilities = typeof CapabilitiesSchema.Type;
export const RangeSchema = Schema.Struct({ startLine: Schema.Int.check(Schema.isGreaterThan(0)), endLine: Schema.Int.check(Schema.isGreaterThan(0)), sourceDigest: Sha256 }).check(Schema.makeFilter(range => range.startLine <= range.endLine));
export const NativeCaseSchema = Schema.Struct({
  nativeId: Text.check(Schema.isPattern(/^[^:\s]+:.+$/u)), project: Text, file: Text, kind: Schema.Literals(['leaf', 'suite']),
  group: Schema.optional(Text), range: Schema.optional(RangeSchema),
  selection: Schema.Struct({ opaqueId: Text, capabilityVersion: Text }), tags: Schema.Record(Text, Schema.String), provenance: Text,
});
export type NativeCase = typeof NativeCaseSchema.Type;
export const NativeResultSchema = Schema.Struct({ nativeId: Text, outcome: Schema.Literals(['passed', 'failed', 'skipped', 'todo', 'not-run']), provenance: Text });
export type NativeResult = typeof NativeResultSchema.Type;
export const InvocationSchema = Schema.Struct({ invocationId: Text, argv: Schema.NonEmptyArray(Text), cwd: Text, envNames: Schema.Array(Text), reports: Schema.Array(Text), requested: Schema.optional(Schema.Array(Text)) });
export type Invocation = typeof InvocationSchema.Type;
export const ContextSchema = Schema.Struct({ root: Text, runId: Text, planId: Text, inputs: Sha256, reportDirectory: Text });
export type AdapterContext = typeof ContextSchema.Type;
export const MemberSchema = Schema.Struct({ path: Text, digest: Sha256 });
export const CapturedSchema = Schema.Struct({ status: ProcessStatusSchema, stdout: Schema.String, stderr: Schema.String, reports: Schema.Array(Schema.Struct({ path: Text, digest: Sha256, text: Schema.String })) });
export type Captured = typeof CapturedSchema.Type;
const planContext = Schema.Record(Text, Schema.Unknown);
export const PlanSchema = Schema.Struct({ invocations: Schema.NonEmptyArray(InvocationSchema).check(Schema.isMaxLength(128)), planContext });
export type AdapterPlan = typeof PlanSchema.Type;
export const ManifestSchema = Schema.Struct({ cases: Schema.Array(NativeCaseSchema).check(Schema.isMaxLength(100_000)), capabilities: CapabilitiesSchema, completeness: CompletenessSchema });
export type NativeManifest = typeof ManifestSchema.Type;
export const AdapterVersionsSchema = Schema.Struct({ framework: Text, runtime: Text, observedFramework: Schema.optional(Text), observedRuntime: Schema.optional(Text) });
export type AdapterVersions = typeof AdapterVersionsSchema.Type;
export const ReportSchema = Schema.Struct({ observed: Schema.Array(NativeResultSchema).check(Schema.isMaxLength(100_000)), capabilities: CapabilitiesSchema, completeness: CompletenessSchema });
export type AdapterReport = typeof ReportSchema.Type;
export const PayloadSchemas = {
  'collect-plan': Schema.Struct({ files: Schema.NonEmptyArray(Text), members: Schema.Array(MemberSchema) }),
  'collect-parse': Schema.Struct({ planContext, captures: Schema.Array(CapturedSchema) }),
  'select-plan': Schema.Struct({ nativeIds: Schema.NonEmptyArray(Text), manifestInputs: Sha256, manifest: ManifestSchema }),
  'report-parse': Schema.Struct({ planContext, requested: Schema.NonEmptyArray(Text), captures: Schema.Array(CapturedSchema) }),
} as const;
export const ResponseSchemas = { 'collect-plan': PlanSchema, 'collect-parse': ManifestSchema, 'select-plan': PlanSchema, 'report-parse': ReportSchema } as const;
export type AdapterOp = keyof typeof PayloadSchemas;
export const RequestSchema = Schema.Struct({ format: Schema.Literal(ADAPTER_FORMAT), op: Schema.Literals(['collect-plan', 'collect-parse', 'select-plan', 'report-parse']), requestId: Text, context: ContextSchema, payload: Schema.Unknown });

export function protocolDecode<A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A {
  try { return decode(schema, value, 'test adapter protocol'); }
  catch (cause) { throw new ConcordError('AdapterProtocolInvalid', cause instanceof Error ? cause.message : String(cause)); }
}
/** JSON.parse cannot detect duplicate object keys. Inspect lexical keys before Schema decoding. */
export function protocolJson(source: string, limit = 8 * 1024 * 1024): unknown {
  if (Buffer.byteLength(source) > limit) throw new ConcordError('AdapterProtocolInvalid', 'Protocol JSON exceeds its byte budget');
  try {
    const stack: { keys?: Set<string>; key: boolean }[] = [];
    // Scan strings iteratively: quantified token regexes exhaust the JS regexp
    // stack on otherwise valid multi-megabyte string values.
    for (let offset = 0; offset < source.length;) {
      const token = source[offset++]!;
      const frame = stack.at(-1);
      if (token === '"') {
        const start = offset - 1;
        while (offset < source.length) {
          const character = source[offset++]!;
          if (character === "\\") offset += 1;
          else if (character === '"') break;
        }
        if (frame?.keys && frame.key) {
          const key = JSON.parse(source.slice(start, offset)) as string;
          if (frame.keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
          frame.keys.add(key);
        }
      } else if (token === '{' || token === '[') {
        stack.push({ ...(token === '{' ? { keys: new Set<string>() } : {}), key: token === '{' });
        if (stack.length > 64) throw new Error('JSON nesting exceeds 64');
      } else if (token === '}' || token === ']') stack.pop();
      else if (token === ',') { if (frame) frame.key = frame.keys !== undefined; }
      else if (token === ':') { if (frame) frame.key = false; }
    }
    const value: unknown = JSON.parse(source);
    const finite = (item: unknown): void => {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite JSON number');
      if (item !== null && typeof item === 'object') for (const child of Object.values(item)) finite(child);
    };
    finite(value); return value;
  } catch (cause) { throw new ConcordError('AdapterProtocolInvalid', `Invalid protocol JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

export function nativeVerdict(requested: readonly string[], observed: readonly NativeResult[], statuses: readonly ProcessStatus[], complete: boolean, assignments?: readonly { readonly invocationId: string; readonly requested?: readonly string[] }[]): 'green' | 'red' | 'invalid' {
  if (!complete || requested.length === 0 || new Set(requested).size !== requested.length || observed.length !== requested.length || new Set(observed.map(item => item.nativeId)).size !== observed.length || observed.some(item => !requested.includes(item.nativeId)) || statuses.length === 0 || new Set(statuses.map(status => status.invocationId)).size !== statuses.length || statuses.some(status => status.exitCode === null || status.signal !== null || status.timedOut || status.cancelled || status.outputTruncated || status.cleanup !== 'complete')) return 'invalid';
  if (assignments) {
    const assigned = assignments.flatMap(item => item.requested ?? []);
    if (assignments.length !== statuses.length || new Set(assignments.map(item => item.invocationId)).size !== assignments.length || assigned.length !== requested.length || new Set(assigned).size !== assigned.length || assigned.some(id => !requested.includes(id))) return 'invalid';
    for (const assignment of assignments) {
      const status = statuses.find(status => status.invocationId === assignment.invocationId);
      const outcomes = observed.filter(item => assignment.requested?.includes(item.nativeId));
      if (!status || !outcomes.length || outcomes.length !== assignment.requested?.length || outcomes.every(item => item.outcome === 'passed') && status.exitCode !== 0 || outcomes.some(item => item.outcome === 'failed') && status.exitCode === 0) return 'invalid';
    }
  }
  if (observed.every(item => item.outcome === 'passed') && statuses.every(status => status.exitCode === 0)) return 'green';
  if (observed.every(item => item.outcome === 'passed' || item.outcome === 'failed') && observed.some(item => item.outcome === 'failed') && statuses.some(status => status.exitCode !== 0)) return 'red';
  return 'invalid';
}
