import { Clock, Effect, FileSystem, Schema } from "effect";
import { IssueClosureSchema, IssueMemoryRelationSchema, IssueSchema, type IssueMeta } from "concord-sdlc/model";
import { RepoRefSchema } from "../docs/trace/ref.js";
import { type FeedbackDocument } from "./codec.js";
import { FeedbackContentInvalid } from "./errors.js";
import type { FeedbackCheckReceipt } from "./repository.js";
import { FeedbackEnvelopeV1Schema, type FeedbackEnvelopeV1 } from "./schema.js";
import { FeedbackStore, type FeedbackMutationReceipt, type FeedbackStoreError } from "./services.js";

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
export type FeedbackCommandOutcome =
  | { readonly domain: "feedback"; readonly operation: MutationOperation; readonly dryRun: boolean; readonly feedback: IssueMeta; readonly receipt: FeedbackMutationReceipt }
  | { readonly domain: "feedback"; readonly operation: "export" | "show"; readonly document: FeedbackDocument }
  | { readonly domain: "feedback"; readonly operation: "list"; readonly feedback: readonly IssueMeta[] }
  | { readonly domain: "feedback"; readonly operation: "check"; readonly receipt: FeedbackCheckReceipt };
function decodeInput(input: unknown): Effect.Effect<FeedbackCommandInput, FeedbackContentInvalid> {
  return Schema.decodeUnknownEffect(FeedbackCommandInputSchema, { errors: "all", onExcessProperty: "error" })(input).pipe(Effect.mapError((error) => new FeedbackContentInvalid({ operation: "decode command", message: String(error) })));
}
function mutationOutcome(operation: MutationOperation, dryRun: boolean, receipt: FeedbackMutationReceipt): FeedbackCommandOutcome { return { domain: "feedback", operation, dryRun, feedback: receipt.value, receipt }; }
export function runFeedbackCommand(input: unknown): Effect.Effect<FeedbackCommandOutcome, FeedbackStoreError | FeedbackContentInvalid, FeedbackStore | FileSystem.FileSystem> {
  return decodeInput(input).pipe(Effect.flatMap((decoded) => Effect.gen(function*() {
    const store = yield* FeedbackStore;
    switch (decoded.operation) {
      case "add": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.create(decoded.document, decoded.dryRun));
      case "import": { const millis = yield* Clock.currentTimeMillis; return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.importEnvelope(decoded.envelope, decoded.artifacts, new Date(millis).toISOString(), decoded.dryRun)); }
      case "export": case "show": return { domain: "feedback" as const, operation: decoded.operation, document: yield* store.read(decoded.id) };
      case "list": { const entries = yield* store.list(); const needle = decoded.pattern?.toLocaleLowerCase(); return { domain: "feedback" as const, operation: decoded.operation, feedback: entries.map((entry) => entry.metadata).filter((entry) => needle === undefined || (entry.id + "\n" + entry.title).toLocaleLowerCase().includes(needle)) }; }
      case "link": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.link(decoded.id, decoded.relation, decoded.dryRun));
      case "adopt": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.adopt(decoded.id, decoded.to, decoded.dryRun));
      case "retire": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.retire(decoded.id, decoded.from, decoded.dryRun));
      case "close": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.close(decoded.id, decoded.closure, decoded.dryRun));
      case "reopen": return mutationOutcome(decoded.operation, decoded.dryRun, yield* store.reopen(decoded.id, decoded.dryRun));
      case "check": return { domain: "feedback" as const, operation: decoded.operation, receipt: yield* store.check() };
    }
  })));
}
export const feedbackCommandContribution = Object.freeze({ name: "feedback", summary: "Record, relate, adopt, retire, close, and validate repository Issues.", input: FeedbackCommandInputSchema, run: runFeedbackCommand });
