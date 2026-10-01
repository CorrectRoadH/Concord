import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Clock, Effect, Option } from "effect";
import { readText, readJson, emit as emitResult, jsonOption, dryRunOption, renderRepositoryFailure } from "../cli-support.js";
import type { TerminalDeliverySink } from "../docs/contribution.js";
import type { RepositoryCommandContribution } from "../contribution.js";
import { MEMORY_KINDS, PROBLEM_RESOLUTION_KINDS, runMemoryCommand, MemoryStore } from "./index.js";
export const memoryCliContribution: RepositoryCommandContribution<"memory", MemoryStore | import("@effect/platform-node/NodeServices").NodeServices> = Object.freeze({
 name: "memory", summary: "Record, search, resolve, supersede, promote, and validate repository Memory.",
 makeCommand(deliver: TerminalDeliverySink) {
  const make = <const Name extends string, const Config extends Command.Command.Config, E, R>(
    name: Name, config: Config, handler: (input: Command.Command.Config.Infer<Config>) => Effect.Effect<void, E, R>,
  ) => Command.make(name, config, input => handler(input).pipe(Effect.catch(error => deliver({ stdout: "", stderr: renderRepositoryFailure(error, process.argv.slice(2).includes("--json")), exitCode: 1 }))));
  const inputOption = Options.string("input").pipe(Options.withDescription("Path to a JSON input document."));
  const emit = (value: unknown, json: boolean) => emitResult(value, json, undefined, undefined, deliver);
  const memoryAdd = make("add", {
    id: Args.string("memory-id"),
    title: Options.string("title"),
    kind: Options.choice("kind", MEMORY_KINDS),
    createdAt: Options.string("created-at").pipe(
      Options.withDescription("Creation date (YYYY-MM-DD); defaults to today."),
      Options.optional,
    ),
    body: Options.string("body").pipe(Options.withDescription("Markdown body path, or - for stdin.")),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ body, createdAt, dryRun, id, json, kind, title }) => Effect.all({
    body: readText(body),
    createdAt: Option.match(createdAt, {
      onNone: () => Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString().slice(0, 10))),
      onSome: Effect.succeed,
    }),
  }).pipe(
    Effect.flatMap(({ body: source, createdAt }) => runMemoryCommand({
      operation: "add",
      metadata: {
        format: "concord.document/v1",
        id,
        title,
        createdAt,
        kind: "memory",
        memoryKind: kind,
        state: kind === "problem" ? "open" : kind === "note" ? "captured" : "current",
        epoch: 0,
        promotions: [],
        history: [],
      },
      body: source,
      dryRun,
    })),
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Add one structured Memory."));

  const memoryList = make("list", { json: jsonOption }, ({ json }) =>
    runMemoryCommand({ operation: "list" }).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
    Command.withDescription("List current-format Memory."),
  );
  const memoryShow = make("show", {
    id: Args.string("memory-id"),
    json: jsonOption,
  }, ({ id, json }) => runMemoryCommand({ operation: "show", id }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Show one Memory."));
  const memorySearch = make("search", {
    pattern: Args.string("pattern"),
    json: jsonOption,
  }, ({ json, pattern }) => runMemoryCommand({ operation: "search", pattern }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Search Memory metadata and body text."));

  const memoryAuthorSet = make("set", {
    id: Args.string("memory-id"),
    body: Options.string("body").pipe(Options.withDescription("Markdown body path, or - for stdin.")),
    expectedOwnerDigest: Options.string("expected-owner-digest"),
    expectedAuthorDigest: Options.string("expected-author-digest"),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ body, dryRun, expectedAuthorDigest, expectedOwnerDigest, id, json }) => readText(body).pipe(
    Effect.flatMap((source) => runMemoryCommand({ operation: "author-set", id, body: source, expectedOwnerDigest, expectedAuthorDigest, dryRun })),
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Replace the author-owned Memory body while preserving managed history."));

  const memoryAuthor = Command.make("author").pipe(
    Command.withDescription("Update author-owned Memory prose."),
    Command.withSubcommands([memoryAuthorSet]),
  );

  const memoryResolve = make("resolve", {
    id: Args.string("memory-id"),
    kind: Options.choice("kind", PROBLEM_RESOLUTION_KINDS),
    reason: Options.string("reason"),
    at: Options.string("at").pipe(Options.optional),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ at, dryRun, id, json, kind, reason }) => runMemoryCommand({
    operation: "resolve",
    id,
    resolution: { kind, reason, ...(Option.isSome(at) ? { at: at.value } : {}) },
    dryRun,
  }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Resolve one structured Problem Memory."));

  const memoryActivate = make("activate", {
    id: Args.string("memory-id"),
    reason: Options.string("reason"),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, id, json, reason }) => runMemoryCommand({ operation: "activate", id, reason, dryRun }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Activate one captured Problem, Decision, or Insight Memory."));

  const memoryReopen = make("reopen", {
    id: Args.string("memory-id"),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, id, json }) => runMemoryCommand({ operation: "reopen", id, dryRun }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Reopen one resolved Problem Memory."));

  const memorySupersede = make("supersede", {
    id: Args.string("memory-id"),
    by: Options.string("by").pipe(Options.withDescription("Replacement Memory ID.")),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ by, dryRun, id, json }) => runMemoryCommand({ operation: "supersede", id, by, dryRun }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Supersede one Decision or Insight Memory."));

  const memoryPromote = make("promote", {
    id: Args.string("memory-id"),
    to: Options.string("to").pipe(Options.withDescription("Exact repository ref promoted by this Memory.")),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, id, json, to }) => runMemoryCommand({ operation: "promote", id, to, dryRun }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Promote Memory into one Roadmap, Feature, Use Case, or Engineering target."));

  const memoryRetire = make("retire", {
    id: Args.string("memory-id"),
    from: Options.string("from").pipe(Options.withDescription("Exact current repository ref to retire.")),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, from, id, json }) => runMemoryCommand({ operation: "retire", id, from, dryRun }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Retire one current Memory promotion while preserving its history."));

  const memoryCheck = make("check", { json: jsonOption }, ({ json }) =>
    runMemoryCommand({ operation: "check" }).pipe(
      Effect.flatMap((outcome) => emit(outcome, json)),
    )).pipe(Command.withDescription("Validate Memory state, promotions, and native regression references."));

  const command = Command.make("memory").pipe(
    Command.withDescription("Record, search, resolve, supersede, promote, and validate repository Memory."),
    Command.withSubcommands([
      memoryAdd,
      memoryList,
      memoryShow,
      memorySearch,
      memoryAuthor,
      memoryActivate,
      memoryResolve,
      memoryReopen,
      memorySupersede,
      memoryPromote,
      memoryRetire,
      memoryCheck,
    ]),
  );

return command as ReturnType<typeof memoryCliContribution.makeCommand>;
 }
});
