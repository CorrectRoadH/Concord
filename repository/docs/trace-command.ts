import { Effect } from "effect";
import { withTraceReadLease } from "./trace/relation-mutation.js";
import { requireCompleteTraceUnderLease } from "./trace/compiler.js";
import { Command, Flag as Options } from "effect/unstable/cli";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./contribution.js";
import { REPOSITORY_ROOT } from "./runtime.js";
import { renderTraceFailure } from "./trace-command-presentation.js";
import { compileTraceReport, recoverTrace, type TraceRecoveryReceipt } from "./trace/index.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this Trace recovery receipt as JSON."),
);

function renderRecovery(receipt: TraceRecoveryReceipt): string {
  return receipt.recovered
    ? `Trace recovery: ${receipt.action}; generation ${receipt.generation}${receipt.owner === undefined ? "" : `; owner ${receipt.owner}`}\n`
    : `Trace recovery: nothing pending; generation ${receipt.generation}\n`;
}

function makeTraceCommand(deliver: TerminalDeliverySink) {
  const recover = Command.make("recover", { json: jsonOption }, ({ json }) => deliverDomainResult(
    recoverTrace(REPOSITORY_ROOT).pipe(Effect.flatMap(receipt => withTraceReadLease(REPOSITORY_ROOT, () => requireCompleteTraceUnderLease(REPOSITORY_ROOT)).pipe(Effect.as(receipt)))),
    json,
    {
      success: (receipt, structured) => structured ? jsonDocument(receipt) : renderRecovery(receipt),
      failure: renderTraceFailure,
    },
    deliver,
  )).pipe(Command.withDescription("Recover or finish one interrupted trace relation publication."));

  return Command.make("trace", { json: jsonOption }, ({ json }) => deliverDomainResult(
    compileTraceReport(REPOSITORY_ROOT), json,
    { success: (report, structured) => structured ? jsonDocument(report) : `Trace generation ${report.snapshot.generation}: ${report.snapshot.nodes.length} nodes, ${report.snapshot.tests.length} tests\n`, failure: renderTraceFailure },
    deliver,
  )).pipe(
    Command.withDescription("Coordinate and recover repository trace relation publications."),
    Command.withSubcommands([recover]),
  );
}

export const traceCommandContribution = defineDocsCommandContribution({
  name: "trace",
  summary: "Coordinate and recover repository trace relation publications.",
  makeCommand: makeTraceCommand,
});
