import type { CandidateIdentity, CapabilityCheck, Category, CommandCapture, RepoReceipt, SelectionReceipt, StageName, StageReceipt, TestkitReceipt } from "./contracts.ts";
/**
 * Receipt shape ownership is centralised in contracts.ts.  This module only
 * owns pure classification and capture folding; it deliberately has no JSON
 * schema version or durable-I/O knowledge.
 */
export type { CandidateIdentity as CandidateReceipt, CapabilityCheck, Category, CommandCapture, RepoReceipt, SelectionReceipt, StageName, StageReceipt, TestkitReceipt, };
export declare function commandFailedCapture(capture: CommandCapture): boolean;
export declare function hasUnconfirmedOwnedGroup(capture: CommandCapture): boolean;
/** Keep full streams on failure; truncate successful captures for log size. */
export declare function retainCapture(capture: CommandCapture, ok: boolean): CommandCapture;
/**
 * Classify a completed receipt (all stages that ran, including cleanup).
 *
 * - capability / browser preflight failure → configuration, before test
 * - prepare failure (source violation / declared-but-not-injected /
 *   undeclared-but-imported) → infra, before any install or test
 * - install / injection failure → infra
 * - test timeout / non-zero → regression
 * - test pass + collect or cleanup failure → infra (cannot pass)
 * - test already regression + later stage failure → keep regression, append detail
 */
export declare function classifyFromReceipt(receipt: Pick<RepoReceipt, "stages" | "detail">): {
    category: Category;
    detail: string;
};
