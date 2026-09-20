import { repositoryRoot } from "./root.js";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Clock, Data, Effect, FileSystem, Layer, Option } from "effect";
import {
  designCommandContribution, featureCommandContribution, makeDocsCommand,
  researchCommandContribution, testCommandContribution, traceCommandContribution,
  useCaseCommandContribution, type TerminalDelivery,
} from "./docs/index.js";
import { FEEDBACK_CLOSURE_KINDS, FEEDBACK_MEMORY_RELATION_KINDS, NodeFeedbackStoreLive, runFeedbackCommand } from "./feedback/index.js";
import { MEMORY_KINDS, NodeMemoryStoreLive, PROBLEM_RESOLUTION_KINDS, runMemoryCommand } from "./memory/index.js";

const ROOT = repositoryRoot();

class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit the complete structured outcome as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Validate and return the planned outcome without writing."),
);
const inputOption = Options.string("input").pipe(
  Options.withDescription("Path to a JSON input document."),
);

function readText(path: string) {
  if (path === "-") {
    return Effect.callback<string, CliInputError>((resume) => {
      let source = "";
      const onData = (chunk: string | Buffer) => { source += chunk.toString(); };
      const onEnd = () => resume(Effect.succeed(source));
      const onError = (error: Error) => resume(Effect.fail(new CliInputError({ path, message: String(error) })));
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
      process.stdin.once("end", onEnd);
      process.stdin.once("error", onError);
      return Effect.sync(() => {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.off("error", onError);
      });
    });
  }
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.mapError((error) => new CliInputError({ path, message: String(error) })),
  );
}

function readJson(path: string) {
  return readText(path).pipe(Effect.flatMap((source) => Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (error) => new CliInputError({
      path,
      message: error instanceof Error ? error.message : String(error),
    }),
  })));
}

function deliverTerminal(delivery: TerminalDelivery) {
  return Effect.sync(() => {
    if (delivery.stdout !== "") process.stdout.write(delivery.stdout);
    if (delivery.stderr !== "") process.stderr.write(delivery.stderr);
    if (delivery.exitCode !== 0) process.exitCode = delivery.exitCode;
  });
}

function resultOk(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const record = value as Record<string, unknown>;
  if (typeof record.ok === "boolean") return record.ok;
  return record.receipt === undefined ? true : resultOk(record.receipt);
}

function emit(
  value: unknown,
  json: boolean,
  rendered?: string,
  exitCode = resultOk(value) ? 0 : 1,
) {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
  const human = typeof record?.summary === "string"
    ? `${record.summary}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
  const output = json ? `${JSON.stringify(value, null, 2)}\n` : rendered ?? human;
  return deliverTerminal({ stdout: output, stderr: "", exitCode });
}

function renderUnhandledError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const tagged = error as {
      readonly _tag?: unknown;
      readonly detail?: unknown;
      readonly message?: unknown;
      readonly receipt?: { readonly problems?: unknown };
    };
    const name = typeof tagged._tag === "string"
      ? tagged._tag
      : error instanceof Error
        ? error.name
        : "RepositoryToolError";
    const message = typeof tagged.detail === "string" && tagged.detail.length > 0
      ? tagged.detail
      : typeof tagged.message === "string" && tagged.message.length > 0
        ? tagged.message
        : undefined;
    if (message !== undefined) return `${name}: ${message}`;
    if (Array.isArray(tagged.receipt?.problems) && tagged.receipt.problems.length > 0) {
      return `${name}: ${tagged.receipt.problems.map(String).join("; ")}`;
    }
    try {
      return `${name}: ${JSON.stringify(error, null, 2)}`;
    } catch {
      return String(error);
    }
  }
  return String(error);
}

const feedbackImport = Command.make("import", {
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

const feedbackExport = Command.make("export", {
  id: Args.string("feedback-id"),
  json: jsonOption,
}, ({ id, json }) => runFeedbackCommand({ operation: "export", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Export one Feedback document."));

const feedbackList = Command.make("list", {
  pattern: Args.string("pattern").pipe(Args.optional),
  json: jsonOption,
}, ({ json, pattern }) => runFeedbackCommand({
  operation: "list",
  pattern: Option.getOrUndefined(pattern),
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("List Feedback, optionally filtered by text."),
);

const feedbackShow = Command.make("show", {
  id: Args.string("feedback-id"),
  json: jsonOption,
}, ({ id, json }) => runFeedbackCommand({ operation: "show", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Show one Feedback document."));

const feedbackLink = Command.make("link", {
  id: Args.string("feedback-id"),
  memory: Options.string("memory"),
  kind: Options.choice("kind", FEEDBACK_MEMORY_RELATION_KINDS),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, kind, memory }) => runFeedbackCommand({
  operation: "link",
  id,
  relation: { kind, memory },
  dryRun,
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("Relate Feedback to an existing Memory."),
);

const feedbackAdopt = Command.make("adopt", {
  id: Args.string("feedback-id"),
  to: Options.string("to").pipe(Options.withDescription("Exact repository ref adopted by this Feedback.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, to }) => runFeedbackCommand({
  operation: "adopt",
  id,
  to,
  dryRun,
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("Adopt Feedback into one Roadmap, Feature, Use Case, or Engineering target."),
);

const feedbackRetire = Command.make("retire", {
  id: Args.string("feedback-id"),
  from: Options.string("from").pipe(Options.withDescription("Exact current repository ref to retire.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, from, id, json }) => runFeedbackCommand({
  operation: "retire",
  id,
  from,
  dryRun,
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("Retire one current Feedback adoption while preserving its history."),
);

const feedbackClose = Command.make("close", {
  id: Args.string("feedback-id"),
  kind: Options.choice("kind", FEEDBACK_CLOSURE_KINDS),
  memory: Options.string("memory").pipe(Options.withDescription("Related Memory ID."), Options.optional),
  target: Options.string("target").pipe(Options.withDescription("Delivered repository ref."), Options.optional),
  proof: Options.string("proof").pipe(
    Options.atLeast(0),
    Options.withDescription("Closure evidence; repeat for each proof item."),
  ),
  canonical: Options.string("canonical").pipe(Options.withDescription("Canonical Feedback ID."), Options.optional),
  evidence: Options.string("evidence").pipe(
    Options.atLeast(0),
    Options.withDescription("Invalid-observation evidence; repeat for each item."),
  ),
  dependency: Options.string("dependency").pipe(Options.withDescription("Fixed external dependency."), Options.optional),
  version: Options.string("version").pipe(Options.withDescription("External fixed version."), Options.optional),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ canonical, dependency, dryRun, evidence, id, json, kind, memory, proof, target, version }) => {
  const memoryValue = Option.getOrUndefined(memory);
  const targetValue = Option.getOrUndefined(target);
  const canonicalValue = Option.getOrUndefined(canonical);
  const dependencyValue = Option.getOrUndefined(dependency);
  const versionValue = Option.getOrUndefined(version);
  const closure = {
    kind,
    ...(memoryValue === undefined ? {} : { memory: memoryValue }),
    ...(targetValue === undefined ? {} : { target: targetValue }),
    ...(proof.length === 0 ? {} : { proof }),
    ...(canonicalValue === undefined ? {} : { canonical: canonicalValue }),
    ...(evidence.length === 0 ? {} : { evidence }),
    ...(dependencyValue === undefined ? {} : { dependency: dependencyValue }),
    ...(versionValue === undefined ? {} : { version: versionValue }),
  };
  return runFeedbackCommand({ operation: "close", id, closure, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
  );
}).pipe(Command.withDescription("Close Feedback with validated evidence."));

const feedbackReopen = Command.make("reopen", {
  id: Args.string("feedback-id"),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json }) => runFeedbackCommand({ operation: "reopen", id, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Reopen closed Issue."));

const feedbackCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
  runFeedbackCommand({ operation: "check" }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Validate Issues, relations, and closures."));

const feedback = Command.make("feedback").pipe(
  Command.withDescription("Audit, relate, close, and validate repository Issues."),
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

const memoryAdd = Command.make("add", {
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

const memoryList = Command.make("list", { json: jsonOption }, ({ json }) =>
  runMemoryCommand({ operation: "list" }).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("List current-format Memory."),
);
const memoryShow = Command.make("show", {
  id: Args.string("memory-id"),
  json: jsonOption,
}, ({ id, json }) => runMemoryCommand({ operation: "show", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Show one Memory."));
const memorySearch = Command.make("search", {
  pattern: Args.string("pattern"),
  json: jsonOption,
}, ({ json, pattern }) => runMemoryCommand({ operation: "search", pattern }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Search Memory metadata and body text."));

const memoryAuthorSet = Command.make("set", {
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

const memoryResolve = Command.make("resolve", {
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

const memoryActivate = Command.make("activate", {
  id: Args.string("memory-id"),
  reason: Options.string("reason"),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, reason }) => runMemoryCommand({ operation: "activate", id, reason, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Activate one captured Problem, Decision, or Insight Memory."));

const memoryReopen = Command.make("reopen", {
  id: Args.string("memory-id"),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json }) => runMemoryCommand({ operation: "reopen", id, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Reopen one resolved Problem Memory."));

const memorySupersede = Command.make("supersede", {
  id: Args.string("memory-id"),
  by: Options.string("by").pipe(Options.withDescription("Replacement Memory ID.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ by, dryRun, id, json }) => runMemoryCommand({ operation: "supersede", id, by, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Supersede one Decision or Insight Memory."));

const memoryPromote = Command.make("promote", {
  id: Args.string("memory-id"),
  to: Options.string("to").pipe(Options.withDescription("Exact repository ref promoted by this Memory.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, to }) => runMemoryCommand({ operation: "promote", id, to, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Promote Memory into one Roadmap, Feature, Use Case, or Engineering target."));

const memoryRetire = Command.make("retire", {
  id: Args.string("memory-id"),
  from: Options.string("from").pipe(Options.withDescription("Exact current repository ref to retire.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, from, id, json }) => runMemoryCommand({ operation: "retire", id, from, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Retire one current Memory promotion while preserving its history."));

const memoryCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
  runMemoryCommand({ operation: "check" }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Validate Memory state, promotions, and native regression references."));

const memory = Command.make("memory").pipe(
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

const docs = makeDocsCommand([
  featureCommandContribution, useCaseCommandContribution, testCommandContribution,
  traceCommandContribution, designCommandContribution, researchCommandContribution,
], deliverTerminal);

const root = Command.make("concord-repo").pipe(
  Command.withDescription("Manage declared test suites, native evidence and repository governance."),
  Command.withSubcommands([feedback, memory, docs]),
);
const live = Layer.mergeAll(NodeServices.layer, NodeFeedbackStoreLive(ROOT), NodeMemoryStoreLive(ROOT));
Command.run(root, { version: "2" }).pipe(
  Effect.catch((error) => deliverTerminal({ stdout: "", stderr: `${renderUnhandledError(error)}\n`, exitCode: 1 })),
  Effect.provide(live),
  NodeRuntime.runMain,
);
