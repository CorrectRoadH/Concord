import type { Effect } from "effect";


/** A complete terminal decision made by one repository-tools domain. */
export interface TerminalDelivery {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}
export type TerminalDeliverySink = (
  delivery: TerminalDelivery,
) => Effect.Effect<void>;
