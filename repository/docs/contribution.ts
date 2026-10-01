import { renderRepositoryFailure } from "../cli-support.js";
import type { Command } from "effect/unstable/cli";
import type * as NodeServicesRequirement from "@effect/platform-node/NodeServices";
import { Effect } from "effect";

/** A complete terminal decision made by one repository-tools domain. */
export interface TerminalDelivery {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type TerminalDeliverySink = (
  delivery: TerminalDelivery,
) => Effect.Effect<void>;

// The unstable CLI intentionally erases heterogeneous subcommand types in
// Command.withSubcommands. Keep that existential type in this composition seam.
export type MountedDocsCommand = Command.Command<any, never, unknown, never, NodeServicesRequirement.NodeServices>;

export type DocsCommandContribution<Name extends string = string> = import("../contribution.js").RepositoryCommandContribution<Name, NodeServicesRequirement.NodeServices>;

export function defineDocsCommandContribution<const Name extends string>(
  contribution: DocsCommandContribution<Name>,
): DocsCommandContribution<Name> {
  return Object.freeze(contribution);
}

export function stdoutDelivery(stdout: string): TerminalDelivery {
  return { stdout, stderr: "", exitCode: 0 };
}

export function stderrDelivery(stderr: string): TerminalDelivery {
  return { stdout: "", stderr, exitCode: 1 };
}

export function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function deliverDomainResult<A, E, R>(
  program: Effect.Effect<A, E, R>,
  json: boolean,
  presentation: {
    readonly success: (value: A, json: boolean) => string;
    readonly failure: (error: E, json: boolean) => string;
  },
  deliver: TerminalDeliverySink,
): Effect.Effect<void, never, R> {
  return Effect.matchEffect(program, {
    onFailure: (error) => deliver(stderrDelivery(renderRepositoryFailure(error, json))),
    onSuccess: (value) => {
      const findings = typeof value === "object" && value !== null && "complete" in value && "findings" in value ? (value as { findings: readonly import("./trace/model.js").TraceFinding[] }).findings : [];
      return deliver({ stdout: presentation.success(value, json), stderr: json ? "" : findings.map(f => `warning: ${f.path}: ${f.message}\n`).join(""), exitCode: 0 });
    },
  });
}
