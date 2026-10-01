import { Clock, Effect, FileSystem, Schema } from "effect";
import { IssueClosureSchema, IssueMemoryRelationSchema, IssueSchema, type IssueMeta } from "concord-sdlc/model";
import { RepoRefSchema } from "../docs/trace/ref.js";
import { type FeedbackDocument } from "./codec.js";
import { FeedbackContentInvalid } from "./errors.js";
import type { FeedbackCheckReceipt } from "./repository.js";
import { FeedbackEnvelopeV1Schema, type FeedbackEnvelopeV1 } from "./schema.js";
import { FeedbackStore, type FeedbackMutationReceipt, type FeedbackStoreError } from "./services.js";

export class CommandRetired extends Schema.TaggedError<CommandRetired>()("CommandRetired", { message: Schema.String, details: Schema.Struct({ command: Schema.String, replacement: Schema.String }) }) {}
const retiredReplacements: Readonly<Record<string, string>> = { link: "concord issue link --kind", adopt: "concord issue adopt", retire: "concord issue retire", close: "concord issue close --kind", reopen: "concord issue reopen --reason" };

const NonEmpty = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const Body = Schema.String;
const MutationFields = { dryRun: Schema.Boolean };
export const FeedbackCommandInputSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("add"), ...MutationFields, document: Schema.Struct({ metadata: IssueSchema, body: Body }) }),
  Schema.Struct({ operation: Schema.Literal("import"), ...MutationFields, envelope: FeedbackEnvelopeV1Schema, artifacts: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("export"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("list"), pattern: Schema.optional(NonEmpty) }),
  Schema.Struct({ operation: Schema.Literal("show"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("link"), ...MutationFields, id: NonEmpty, relation: IssueMemoryRelationSchema }),
  Schema.Struct({ operation: Schema.Literal("adopt"), ...MutationFields, id: NonEmpty, to: RepoRefSchema }),
  Schema.Struct({ operation: Schema.Literal("retire"), ...MutationFields, id: NonEmpty, from: RepoRefSchema }),
  Schema.Struct({ operation: Schema.Literal("close"), ...MutationFields, id: NonEmpty, closure: IssueClosureSchema }),
  Schema.Struct({ operation: Schema.Literal("reopen"), ...MutationFields, id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("check") }),
]);
export type FeedbackCommandInput = typeof FeedbackCommandInputSchema.Type;
type MutationOperation = "add" | "import" | "link" | "adopt" | "retire" | "close" | "reopen";
type ReadReport = { readonly complete: boolean; readonly findings: readonly import("../docs/trace/model.js").TraceFinding[] };
export type FeedbackCommandOutcome =
  | { readonly domain: "feedback"; readonly operation: MutationOperation; readonly dryRun: boolean; readonly feedback: IssueMeta; readonly receipt: FeedbackMutationReceipt }
  | (ReadReport & { readonly domain: "feedback"; readonly operation: "export" | "show"; readonly document: FeedbackDocument })
  | (ReadReport & { readonly domain: "feedback"; readonly operation: "list"; readonly feedback: readonly IssueMeta[] })
  | ({ readonly complete: boolean; readonly domain: "feedback"; readonly operation: "check"; readonly ok: boolean; readonly violations: readonly string[]; readonly incomplete: readonly import("../docs/trace/model.js").TraceFinding[]; readonly receipt: FeedbackCheckReceipt });

function decodeInput(input: unknown): Effect.Effect<FeedbackCommandInput, FeedbackContentInvalid> {
  return Schema.decodeUnknownEffect(FeedbackCommandInputSchema, { errors: "all", onExcessProperty: "error" })(input).pipe(Effect.mapError((error) => new FeedbackContentInvalid({ operation: "decode command", message: String(error) })));
}
function mutationOutcome(operation: MutationOperation, dryRun: boolean, receipt: FeedbackMutationReceipt): FeedbackCommandOutcome { return { domain: "feedback", operation, dryRun, feedback: receipt.value, receipt }; }
export function runFeedbackCommand(input: unknown): Effect.Effect<FeedbackCommandOutcome, FeedbackStoreError | FeedbackContentInvalid | CommandRetired, FeedbackStore | FileSystem.FileSystem> {
  if (typeof input === "object" && input !== null && "operation" in input && typeof input.operation === "string" && retiredReplacements[input.operation] !== undefined) {
    const replacement = retiredReplacements[input.operation]!;
    return Effect.fail(new CommandRetired({ message: `Use ${replacement}`, details: { command: `concord repo feedback ${input.operation}`, replacement } }));
  }
  return decodeInput(input).pipe(Effect.flatMap((decoded) => Effect.gen(function*() {
    const store = yield* FeedbackStore;
    const report = store.traceReport === undefined ? { complete: true, findings: [] } : yield* store.traceReport();
    switch (decoded.operation) {
      case "add": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.create(decoded.document, decoded.dryRun));
      case "import": { const millis = yield* Clock.currentTimeMillis; return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.importEnvelope(decoded.envelope, decoded.artifacts, new Date(millis).toISOString(), decoded.dryRun)); }
      case "export": case "show": return { domain: "feedback" as const, operation: decoded.operation, complete: report.complete, findings: report.findings, document: yield* store.read(decoded.id) };
      case "list": { const entries = yield* store.list(); const needle = decoded.pattern?.toLocaleLowerCase(); return { domain: "feedback" as const, operation: decoded.operation, complete: report.complete, findings: report.findings, feedback: entries.map((entry) => entry.metadata).filter((entry) => needle === undefined || (entry.id + "\n" + entry.title).toLocaleLowerCase().includes(needle)) }; }
      case "link": case "adopt": case "retire": case "close": case "reopen": {
        const replacement = retiredReplacements[decoded.operation]!;
        return yield* new CommandRetired({ message: `Use ${replacement}`, details: { command: `concord repo feedback ${decoded.operation}`, replacement } });
      }
      case "check": { const receipt = yield* store.check(); return { domain: "feedback" as const, operation: decoded.operation, complete: report.complete, ok: receipt.ok && report.complete, violations: receipt.findings, incomplete: report.findings, receipt }; }
    }
  })));
}
export const feedbackCommandContribution = Object.freeze({ name: "feedback", summary: "Import and export downstream Feedback envelopes; inspect and validate Issues.", input: FeedbackCommandInputSchema, run: runFeedbackCommand });
