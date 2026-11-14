// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/collect-native-tests.md#discover
import { Schema } from "effect";
import { ConcordError, Nat, Sha256, Text, decode } from "./shared.ts";

export const ADAPTER_FORMAT = 'concord.test-adapter/v1' as const;
export const ProcessStatusSchema = Schema.Struct({ invocationId: Text, exitCode: Schema.NullOr(Nat), signal: Schema.NullOr(Text), timedOut: Schema.Boolean, cancelled: Schema.Boolean, outputTruncated: Schema.Boolean, cleanup: Schema.Literals(['complete', 'unknown']) });
export type ProcessStatus = typeof ProcessStatusSchema.Type;
export const CompletenessSchema = Schema.Struct({ complete: Schema.Boolean, gaps: Schema.Array(Text) }).check(Schema.makeFilter(value => value.complete || value.gaps.length > 0));
export const CapabilitiesSchema = Schema.Struct({ realCollection: Schema.Boolean, leaf: Schema.Boolean, parameterGroups: Schema.Boolean, range: Schema.Boolean, tags: Schema.Boolean, rangeTrivia: Schema.Boolean });
export type Capabilities = typeof CapabilitiesSchema.Type;
export const RangeSchema = Schema.Struct({ startLine: Schema.Int.check(Schema.isGreaterThan(0)), endLine: Schema.Int.check(Schema.isGreaterThan(0)), sourceDigest: Sha256 }).check(Schema.makeFilter(range => range.startLine <= range.endLine));
export const NativeCaseSchema = Schema.Struct({
  nativeId: Text.check(Schema.isPattern(/^[^:\s]+:.+$/u)), project: Text, file: Text, kind: Schema.Literals(['leaf', 'suite']),
  group: Schema.optional(Text), range: Schema.optional(RangeSchema),
  tags: Schema.Record(Text, Schema.String), provenance: Text,
});
export type NativeCase = typeof NativeCaseSchema.Type;

/** Query-time projection of current native identities bound to one source marker. */
const { provenance: _provenance, ...bindingCaseFields } = NativeCaseSchema.fields;
export const NativeBindingViewSchema = Schema.Struct({
  testId: Text,
  current: Schema.Boolean,
  complete: Schema.Boolean,
  nativeCases: Schema.Array(Schema.Struct(bindingCaseFields)),
  gaps: Schema.Array(Text),
});
export type NativeBindingView = typeof NativeBindingViewSchema.Type;

export const InvocationSchema = Schema.Struct({ invocationId: Text, argv: Schema.NonEmptyArray(Text), cwd: Text, envNames: Schema.Array(Text), reports: Schema.Array(Text) });
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
export const PayloadSchemas = {
  'collect-plan': Schema.Struct({ files: Schema.NonEmptyArray(Text), members: Schema.Array(MemberSchema) }),
  'collect-parse': Schema.Struct({ planContext, captures: Schema.Array(CapturedSchema) }),
} as const;
export const ResponseSchemas = { 'collect-plan': PlanSchema, 'collect-parse': ManifestSchema } as const;
export type AdapterOp = keyof typeof PayloadSchemas;
export const RequestSchema = Schema.Struct({ format: Schema.Literal(ADAPTER_FORMAT), op: Schema.Literals(['collect-plan', 'collect-parse']), requestId: Text, context: ContextSchema, payload: Schema.Unknown });

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
