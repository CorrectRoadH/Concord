import type { Command } from "effect/unstable/cli";
import { type TerminalDeliverySink } from "./repo-docs-contribution.js";
export interface RepositoryCommandContribution<Name extends string = string, R = never> {
 readonly name: Name;
 readonly summary: string;
 readonly makeCommand: (deliver: TerminalDeliverySink) => Command.Command<any, never, unknown, never, R>;
}

