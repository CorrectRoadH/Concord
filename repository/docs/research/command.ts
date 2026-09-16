import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option } from "effect";

import {
  jsonDocument,
  stderrDelivery,
  stdoutDelivery,
  type TerminalDeliverySink,
} from "../contribution.js";
import { REPOSITORY_ROOT } from "../runtime.js";
import { runResearchAt, renderResearchError, renderResearchOutcome } from "./domain.js";
import type { ResearchContent, ResearchOutcome } from "./model.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit the Research-owned receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Validate and return the exact publication receipt without writing."),
);
function contentOptions() {
  return {
    title: Options.string("title").pipe(Options.withDescription("Research page title.")),
    body: Options.string("body").pipe(Options.optional, Options.withDescription("Optional free-form Markdown body.")),
    observedAt: Options.string("observed-at").pipe(Options.optional, Options.withDescription("Optional observation timestamp.")),
    sources: Options.string("source").pipe(Options.atLeast(0), Options.withDescription("Optional source text or local path; repeat for more.")),
  };
}

function contentFrom(options: {
  readonly title: string;
  readonly body: Option.Option<string>;
  readonly observedAt: Option.Option<string>;
  readonly sources: readonly string[];
}): ResearchContent {
  return {
    title: options.title,
    ...(Option.isSome(options.body) ? { body: options.body.value } : {}),
    ...(Option.isSome(options.observedAt) ? { observedAt: options.observedAt.value } : {}),
    sources: options.sources,
  };
}

function deliverResearchOutcome(
  program: Effect.Effect<ResearchOutcome, import("./errors.js").ResearchError>,
  json: boolean,
  deliver: TerminalDeliverySink,
) {
  return Effect.matchEffect(program, {
    onFailure: (error) => deliver(stderrDelivery(
      json ? jsonDocument({ ok: false, error }) : `${renderResearchError(error)}\n`,
    )),
    onSuccess: (outcome) => deliver((outcome.command === "check" && !outcome.ok)
      ? { stdout: json ? jsonDocument(outcome) : `${renderResearchOutcome(outcome)}\n`, stderr: "", exitCode: 1 }
      : stdoutDelivery(json ? jsonDocument(outcome) : `${renderResearchOutcome(outcome)}\n`)),
  });
}

/** Builds the independent Research command contribution for the Docs command tree. */
export function makeResearchCommand(deliver: TerminalDeliverySink, root = REPOSITORY_ROOT) {

  const createPage = Command.make("page", {
    json: jsonOption,
  }, ({ json }) => deliverResearchOutcome(runResearchAt(root, {
    command: "create-page",
  }), json, deliver)).pipe(
    Command.withDescription("Standalone Research pages require offline migration."),
  );

  const packageOptions = contentOptions();
  const createPackage = Command.make("package", {
    path: Args.string("path").pipe(
      Args.withDescription("Relative package path under docs/research."),
    ),
    ...packageOptions,
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json, path, ...content }) => deliverResearchOutcome(runResearchAt(root, {
    command: "create-package",
    path,
    content: contentFrom(content),
    dryRun,
  }), json, deliver)).pipe(
    Command.withDescription("Create a Concord Research package root."),
  );

  const addPageOptions = contentOptions();
  const addPage = Command.make("add-page", {
    parent: Args.string("package-ref").pipe(
      Args.withDescription("Exact research: ref of the package README."),
    ),
    page: Args.string("page").pipe(
      Args.withDescription("Safe relative Markdown page path, including the .md suffix."),
    ),
    ...addPageOptions,
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json, page, parent, ...content }) => deliverResearchOutcome(runResearchAt(root, {
    command: "add-page",
    parent,
    page,
    content: contentFrom(content),
    dryRun,
  }), json, deliver)).pipe(
    Command.withDescription("Add one explicitly package-owned Research page."),
  );

  const check = Command.make("check", {
    ref: Args.string("exact-research-ref"),
    json: jsonOption,
  }, ({ json, ref }) => deliverResearchOutcome(
    runResearchAt(root, { command: "check", ref }),
    json,
    deliver,
  )).pipe(
    Command.withDescription("Check exactly one Research page or package root and its explicitly owned pages; --all is intentionally unsupported."),
  );

  return Command.make("research").pipe(
    Command.withDescription("Create and precisely check Research-owned v1 decision inputs."),
    Command.withSubcommands([createPage, createPackage, addPage, check]),
  );
}

export type ResearchCommandError = import("./errors.js").ResearchError;
