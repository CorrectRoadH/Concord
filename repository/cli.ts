import { repositoryRoot } from "./root.js";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";
import { Effect, Layer } from "effect";
import { designCommandContribution, featureCommandContribution, makeDocsCommand, researchCommandContribution, testCommandContribution, traceCommandContribution, useCaseCommandContribution } from "./docs/index.js";
import { feedbackCliContribution, NodeFeedbackStoreLive } from "./feedback/index.js";
import { memoryCliContribution, NodeMemoryStoreLive } from "./memory/index.js";
import { deliverTerminal, runComposedCli } from "./cli-support.js";
const ROOT = repositoryRoot();
const docs = makeDocsCommand([
  featureCommandContribution, useCaseCommandContribution, testCommandContribution,
  traceCommandContribution, designCommandContribution, researchCommandContribution,
], deliverTerminal);

const root = Command.make("concord-repo").pipe(
  Command.withDescription("Manage declared test suites, native evidence and repository governance."),
  Command.withSubcommands([feedbackCliContribution.makeCommand(deliverTerminal), memoryCliContribution.makeCommand(deliverTerminal), docs]),
);
const live = Layer.mergeAll(NodeServices.layer, NodeFeedbackStoreLive(ROOT), NodeMemoryStoreLive(ROOT));
runComposedCli(root, { version: "2" }).pipe(
  Effect.provide(live),
  NodeRuntime.runMain,
);
