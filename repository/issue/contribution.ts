import { Clock, Context, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { RepositoryCommandContribution } from "../contribution.js";
import type { TerminalDeliverySink } from "../docs/contribution.js";
import { IssuePlanStore, IssueRemote, executeIssuePlan, issueAuthorization, issueTarget, prepareIssue } from "./domain.js";
import { IssueInputError, type IssueError } from "./errors.js";
import { IssuePayloadSchema, type IssueBinding, type IssueIdentity, type CreateIdentity, type IssuePayload } from "./model.js";
export class IssueProject extends Context.Service<IssueProject, {
  readonly connection: (id: string) => Effect.Effect<IssueBinding, IssueError>;
  readonly readBody: (path: string) => Effect.Effect<string, IssueError>;
}>()("concord/issue/Project") {}
export type IssueCommandRequirements = IssueRemote | IssuePlanStore | IssueProject;
export type IssueCommandRunner<R = never> = <A>(connection: string, execute: boolean, program: Effect.Effect<A, IssueError, IssueCommandRequirements>) => Effect.Effect<A, IssueError, R>;
export function makeIssueRemoteSubcommands<R = never>(deliver: TerminalDeliverySink, run?: IssueCommandRunner<R>, sharedJson = false) {
  const connection = Flag.string("connection");
  const json = Flag.boolean("json").pipe(Flag.withDefault(false));
  const jsonConfig = sharedJson ? {} : { json };
  const output = (value: unknown, structured: boolean) => deliver({ stdout: `${JSON.stringify(value, null, structured ? undefined : 2)}\n`, stderr: "", exitCode: 0 });
  const handle = <A>(id: string, execute: boolean, program: Effect.Effect<A, IssueError, IssueCommandRequirements>, structured: boolean) => {
    const handled: Effect.Effect<A, IssueError, IssueCommandRequirements | R> = run === undefined ? program : run(id, execute, program);
    return handled.pipe(Effect.matchEffect({ onSuccess: value => output(value, structured), onFailure: error => {
      const code = "code" in error ? error.code : error._tag === "IssueInputError" ? "InvalidInput" : error._tag;
      const message = "message" in error && error.message ? error.message : code;
      const details = "details" in error ? error.details : undefined;
      return deliver({ stdout: "", stderr: `${structured ? JSON.stringify({ ok: false, error: code, message, ...(details === undefined ? {} : { details }) }) : `${code}: ${message}`}\n`, exitCode: 1 });
    } }));
  };
  const plan = (id: string, number: number | undefined, payload: IssuePayload, originKey?: string) => Effect.gen(function*() {
    const project = yield* IssueProject;
    const binding = yield* project.connection(id);
    const validated = yield* Effect.try({ try: () => Schema.decodeUnknownSync(IssuePayloadSchema, { onExcessProperty: "error" })(payload), catch: () => new IssueInputError({ message: "Invalid Issue payload or label (maximum 50 characters, no control characters)" }) });
    const identity: IssueIdentity | CreateIdentity = number === undefined ? { ...binding.repository, kind: originKey === undefined ? "manual" : "machine-origin", ...(originKey === undefined ? {} : { originKey }) } : { ...binding.repository, number };
    const receipt = yield* prepareIssue(identity, payload.operation, validated, yield* Clock.currentTimeMillis, binding);
    return { operation: "issue-plan", receiptId: receipt.id, connection: receipt.connection, issueOperation: receipt.operation, target: issueTarget(receipt), payloadDigest: receipt.payloadDigest, remotePreimageDigest: receipt.remotePreimageDigest, expiresAt: new Date(receipt.expiresAt).toISOString(), authorize: issueAuthorization(receipt) };
  });
  const number = Argument.integer("number").pipe(Argument.filter(n => n > 0 && Number.isSafeInteger(n), () => "Issue number must be a positive safe integer"));
  const bodyPlan = (operation: "body-set" | "comment-add") => Command.make(operation, { number, connection, ...jsonConfig, body: Flag.string("body") }, args => handle(args.connection, false, Effect.gen(function*() {
    const body = yield* (yield* IssueProject).readBody(args.body);
    return yield* plan(args.connection, args.number, { operation, body });
  }), process.argv.includes("--json"))).pipe(Command.withDescription(`Plan one Issue ${operation} write.`));
  return [
    Command.make("plan").pipe(Command.withDescription("Read remote Issues and prepare one explicitly authorized write."), Command.withSubcommands([
      Command.make("create", { connection, ...jsonConfig, title: Flag.string("title"), body: Flag.string("body"), originKey: Flag.string("origin-key").pipe(Flag.optional) }, args => handle(args.connection, false, Effect.gen(function*() {
        const body = yield* (yield* IssueProject).readBody(args.body);
        return yield* plan(args.connection, undefined, { operation: "create", title: args.title, body }, Option.getOrUndefined(args.originKey));
      }), process.argv.includes("--json"))).pipe(Command.withDescription("Plan creation of one remote Issue.")),
      bodyPlan("body-set"), bodyPlan("comment-add"),
      Command.make("labels-add", { number, connection, ...jsonConfig, labels: Flag.string("label").pipe(Flag.atLeast(1)) }, args => handle(args.connection, false, plan(args.connection, args.number, { operation: "labels-add", labels: [...new Set(args.labels)].sort() }), process.argv.includes("--json"))).pipe(Command.withDescription("Plan adding labels to one Issue.")),
      Command.make("labels-remove", { number, connection, ...jsonConfig, label: Flag.string("label").pipe(Flag.between(1, 1)) }, args => handle(args.connection, false, plan(args.connection, args.number, { operation: "labels-remove", labels: args.label }), process.argv.includes("--json"))).pipe(Command.withDescription("Plan removal of exactly one Issue label.")),
      Command.make("close", { number, connection, ...jsonConfig, reason: Flag.choice("reason", ["completed", "not_planned"]).pipe(Flag.optional) }, args => handle(args.connection, false, plan(args.connection, args.number, { operation: "close", ...(Option.isSome(args.reason) ? { reason: args.reason.value } : {}) }), process.argv.includes("--json"))).pipe(Command.withDescription("Plan closing one Issue.")),
      Command.make("reopen", { number, connection, ...jsonConfig }, args => handle(args.connection, false, plan(args.connection, args.number, { operation: "reopen" }), process.argv.includes("--json"))).pipe(Command.withDescription("Plan reopening one Issue.")),
    ])),
    Command.make("execute", { receiptId: Argument.string("receipt-id"), connection, authorize: Flag.string("authorize"), ...jsonConfig }, args => handle(args.connection, true, Effect.gen(function*() {
      const receipt = yield* (yield* IssuePlanStore).read(args.receiptId);
      const binding = yield* (yield* IssueProject).connection(args.connection);
      const result = yield* executeIssuePlan(receipt, yield* Clock.currentTimeMillis, binding, args.authorize);
      const { number, url, state, title, labels } = result.issue;
      return { operation: "issue-execute", receiptId: receipt.id, issueOperation: receipt.operation, issue: { number, url, state, title, labels } };
    }), process.argv.includes("--json"))).pipe(Command.withDescription("Execute one Issue plan after explicit user authorization.")),
  ] as const;
}
export const issueRemoteCommandContribution: RepositoryCommandContribution<"issue", IssueCommandRequirements> = Object.freeze({
  name: "issue", summary: "Plan and explicitly authorize remote Issue writes.",
  makeCommand: (deliver: TerminalDeliverySink) => Command.make("issue").pipe(Command.withSubcommands(makeIssueRemoteSubcommands(deliver))),
});
export * from "./domain.js";
export { makeNodeIssuePlanStore, NodeIssuePlanStoreLive } from "./plan-store.js";
export type { CreateIdentity, IssueIdentity, IssueMutationResult, IssueOperation, IssuePayload, IssuePlanReceipt, IssueRepository, RemoteIssue } from "./model.js";
