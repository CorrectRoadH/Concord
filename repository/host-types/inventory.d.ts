import { Effect } from "effect";
import { OwnedProcess } from "./owned-process.js";
export declare const CASE_ID_PATTERN: RegExp;
export type InventoryExecutor = "vitest" | "playwright";
export interface CollectedCase {
    readonly executor: InventoryExecutor;
    readonly repo: string;
    readonly path: string;
    readonly project?: string;
    readonly titlePath: readonly string[];
    readonly caseId: `necase_${string}`;
}
export interface CaseInventoryReceipt {
    readonly executor: {
        readonly name: InventoryExecutor;
        readonly version: string;
    };
    readonly repo: string;
    readonly argv: readonly string[];
    readonly checkout: string;
    readonly files: readonly string[];
    readonly cases: readonly CollectedCase[];
    readonly unassignedCases: readonly RawCollectedCase[];
    readonly bodyExecutions: 0;
    readonly forbiddenSetupExecutions: 0;
    readonly findings: readonly string[];
    readonly digest: `sha256:${string}`;
    readonly exit: number | null;
    readonly signal: string | null;
}
declare const InventoryError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "InventoryError";
} & Readonly<A>;
export declare class InventoryError extends InventoryError_base<{
    readonly detail: string;
    readonly receipt: CaseInventoryReceipt;
}> {
}
export interface RawCollectedCase {
    readonly file: string;
    readonly project?: string;
    readonly titlePath: readonly string[];
}
export interface InventoryOptions {
    readonly executor: InventoryExecutor;
    readonly repo: string;
    readonly cwd: string;
    readonly checkout: string;
    readonly nativeArgs: readonly string[];
}
export declare const collectCaseInventory: (options: InventoryOptions) => Effect.Effect<CaseInventoryReceipt, import("./owned-process.js").OwnedProcessError | InventoryError, import("effect/Scope").Scope | OwnedProcess>;
export {};
