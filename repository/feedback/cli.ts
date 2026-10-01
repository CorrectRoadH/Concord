import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { readJson, emit as emitResult, jsonOption, dryRunOption, renderRepositoryFailure } from "../cli-support.js";
import type { TerminalDeliverySink } from "../docs/contribution.js";
import type { RepositoryCommandContribution } from "../contribution.js";
import { runFeedbackCommand, FeedbackStore } from "./index.js";
export const feedbackCliContribution: RepositoryCommandContribution<"feedback", FeedbackStore | import("@effect/platform-node/NodeServices").NodeServices> = Object.freeze({
 name: "feedback", summary: "Import and export downstream Feedback envelopes; inspect and validate Issues.",
 makeCommand(deliver: TerminalDeliverySink) {
  const make = <const Name extends string, const Config extends Command.Command.Config, E, R>(
    name: Name, config: Config, handler: (input: Command.Command.Config.Infer<Config>) => Effect.Effect<void, E, R>,
  ) => Command.make(name, config, input => handler(input).pipe(Effect.catch(error => deliver({ stdout: "", stderr: renderRepositoryFailure(error, process.argv.slice(2).includes("--json")), exitCode: 1 }))));
  const emit = (value: unknown, json: boolean) => emitResult(value, json, undefined, undefined, deliver);
  const feedbackImport = make("import", {
    envelope: Options.string("envelope").pipe(Options.withDescription("Feedback envelope JSON path, or - for stdin.")),
    artifacts: Options.string("artifacts").pipe(Options.withDescription("Envelope artifact directory.")),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ artifacts, dryRun, envelope, json }) => readJson(envelope).pipe(
    Effect.flatMap((value) => runFeedbackCommand({
      operation: "import",
      envelope: value,
      artifacts,
      dryRun,
    })),
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Import one verified downstream Feedback envelope."));

  const feedbackExport = make("export", {
    id: Args.string("feedback-id"),
    json: jsonOption,
  }, ({ id, json }) => runFeedbackCommand({ operation: "export", id }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Export one Feedback document."));

  const feedbackList = make("list", {
    pattern: Args.string("pattern").pipe(Args.optional),
    json: jsonOption,
  }, ({ json, pattern }) => runFeedbackCommand({
    operation: "list",
    pattern: Option.getOrUndefined(pattern),
  }).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
    Command.withDescription("List Feedback, optionally filtered by text."),
  );

  const feedbackShow = make("show", {
    id: Args.string("feedback-id"),
    json: jsonOption,
  }, ({ id, json }) => runFeedbackCommand({ operation: "show", id }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Show one Feedback document."));

  const retiredIndex = process.argv.indexOf("feedback");
  if (retiredIndex >= 2 && ["link", "adopt", "retire", "close", "reopen"].includes(process.argv[retiredIndex + 1] ?? "")) {
    const json = process.argv.includes("--json"); process.argv.splice(retiredIndex + 2); if (json) process.argv.push("--json");
  }
  const retired = (name: string, replacement: string) => make(name, { json: jsonOption }, () => runFeedbackCommand({ operation: name }).pipe(Effect.asVoid)).pipe(Command.withDescription(`Use ${replacement} to maintain an Issue.`));
  const feedbackLink = retired("link", "concord issue link --kind");
  const feedbackAdopt = retired("adopt", "concord issue adopt");
  const feedbackRetire = retired("retire", "concord issue retire");
  const feedbackClose = retired("close", "concord issue close --kind");
  const feedbackReopen = retired("reopen", "concord issue reopen --reason");

  const feedbackCheck = make("check", { json: jsonOption }, ({ json }) =>
    runFeedbackCommand({ operation: "check" }).pipe(
      Effect.flatMap((outcome) => emit(outcome, json)),
    )).pipe(Command.withDescription("Validate Issues, relations, and closures."));

  const command = Command.make("feedback").pipe(
    Command.withDescription("Import and export downstream Feedback envelopes; inspect and validate Issues."),
    Command.withSubcommands([
      feedbackImport,
      feedbackExport,
      feedbackList,
      feedbackShow,
      feedbackLink,
      feedbackAdopt,
      feedbackRetire,
      feedbackClose,
      feedbackReopen,
      feedbackCheck,
    ]),
  );

return command as ReturnType<typeof feedbackCliContribution.makeCommand>;
 }
});
