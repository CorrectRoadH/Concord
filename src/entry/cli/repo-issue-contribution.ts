import { planRemoteIssue, readRemoteIssueBody, executeRemoteIssue } from "../../app/index.ts";

import type { IssueCommandRequirements, IssueCommandRunner } from "../../app/index.ts";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import type { TerminalDeliverySink } from "./delivery.ts";

import type { ConcordError} from "../../model/index.ts";
import { type IssueError } from "../../model/index.ts";
import { CliInvocation } from './invocation.ts';

export function makeIssueRemoteSubcommands<R, DeliveryE, DeliveryR>(deliver: TerminalDeliverySink<DeliveryE, DeliveryR>, run: IssueCommandRunner<R>, sharedJson?: boolean): readonly Command.Command<any, never, unknown, DeliveryE, R | DeliveryR | CliInvocation>[];
export function makeIssueRemoteSubcommands<R = never, DeliveryE = never, DeliveryR = never>(deliver: TerminalDeliverySink<DeliveryE, DeliveryR>, run?: IssueCommandRunner<R>, sharedJson?: boolean): readonly Command.Command<any, never, unknown, DeliveryE, IssueCommandRequirements | R | DeliveryR | CliInvocation>[];
export function makeIssueRemoteSubcommands<R = never, DeliveryE = never, DeliveryR = never>(deliver: TerminalDeliverySink<DeliveryE, DeliveryR>, run?: IssueCommandRunner<R>, sharedJson = false) {
  const connection = Flag.String("connection");
  const json = Flag.Boolean("json").pipe(Flag.withDefault(false));
  const jsonConfig: object = sharedJson ? {} : { json };
  const output = (value: unknown, structured: boolean) => deliver({ stdout: `${JSON.stringify(value, null, structured ? undefined : 2)}\n`, stderr: "", exitCode: 0 });
  const handle = <A>(id: string, execute: boolean, program: Effect.Effect<A, IssueError, IssueCommandRequirements>) => Effect.gen(function*() {
    const structured = (yield* CliInvocation).argv.includes('--json');
    const handled: Effect.Effect<A, IssueError | ConcordError, IssueCommandRequirements | R> = run === undefined ? program : run(id, execute, program);
    return yield* handled.pipe(Effect.matchEffect({ onSuccess: value => output(value, structured), onFailure: error => {
      const code = "code" in error ? error.code : error._tag === "IssueInputError" ? "InvalidInput" : error._tag;
      const message = "message" in error && error.message ? error.message : code;
      const details = "details" in error ? error.details : undefined;
      return deliver({ stdout: "", stderr: `${structured ? JSON.stringify({ ok: false, error: code, message, ...(details === undefined ? {} : { details }) }) : `${code}: ${message}`}\n`, exitCode: 1 });
    } }));
  });
  const number = Argument.Int("number").pipe(Argument.filter(n => n > 0 && Number.isSafeInteger(n), () => "Issue number must be a positive safe integer"));
  const bodyPlan = (operation: "body-set" | "comment-add") => Command.make(operation, { number, connection, ...jsonConfig, body: Flag.String("body") }, args => handle(args.connection, false, Effect.gen(function*() {
    const body = yield* readRemoteIssueBody(args.body);
    return yield* planRemoteIssue(args.connection, args.number, { operation, body });
  }))).pipe(Command.withDescription(`Plan one Issue ${operation} write.`));
  return [
    Command.make("preview").pipe(Command.withDescription("Read remote Issues and prepare one explicitly authorized write."), Command.withSubcommands([
      Command.make("create", { connection, ...jsonConfig, title: Flag.String("title"), body: Flag.String("body"), originKey: Flag.String("origin-key").pipe(Flag.optional) }, args => handle(args.connection, false, Effect.gen(function*() {
        const body = yield* readRemoteIssueBody(args.body);
        return yield* planRemoteIssue(args.connection, undefined, { operation: "create", title: args.title, body }, Option.getOrUndefined(args.originKey));
      }))).pipe(Command.withDescription("Plan creation of one remote Issue.")),
      bodyPlan("body-set"), bodyPlan("comment-add"),
      Command.make("labels-add", { number, connection, ...jsonConfig, labels: Flag.String("label").pipe(Flag.atLeast(1)) }, args => handle(args.connection, false, planRemoteIssue(args.connection, args.number, { operation: "labels-add", labels: [...new Set(args.labels)].sort() }))).pipe(Command.withDescription("Plan adding labels to one Issue.")),
      Command.make("labels-remove", { number, connection, ...jsonConfig, label: Flag.String("label").pipe(Flag.between(1, 1)) }, args => handle(args.connection, false, planRemoteIssue(args.connection, args.number, { operation: "labels-remove", labels: args.label }))).pipe(Command.withDescription("Plan removal of exactly one Issue label.")),
      Command.make("close", { number, connection, ...jsonConfig, reason: Flag.Literals("reason", ["completed", "not_planned"]).pipe(Flag.optional) }, args => handle(args.connection, false, planRemoteIssue(args.connection, args.number, { operation: "close", ...(Option.isSome(args.reason) ? { reason: args.reason.value } : {}) }))).pipe(Command.withDescription("Plan closing one Issue.")),
      Command.make("reopen", { number, connection, ...jsonConfig }, args => handle(args.connection, false, planRemoteIssue(args.connection, args.number, { operation: "reopen" }))).pipe(Command.withDescription("Plan reopening one Issue.")),
    ])),
    Command.make("apply", { receiptId: Argument.String("receipt-id"), connection, authorize: Flag.String("authorize"), ...jsonConfig }, args => handle(args.connection, true, executeRemoteIssue(args.connection, args.receiptId, args.authorize))).pipe(Command.withDescription("Execute one Issue plan after explicit user authorization.")),
  ] as const;
}
