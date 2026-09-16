import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { type CaseInventoryReceipt, type CollectedCase, type InventoryExecutor } from "./inventory.js";
/** A re-collectable logical request. It deliberately contains no scratch location. */
export interface WorkspaceCollectionSpec {
    readonly checkout: string;
}
interface CollectedSubject {
    readonly executor: InventoryExecutor;
    readonly repo: string;
    readonly path: string;
    readonly project?: string;
    readonly titlePath: readonly string[];
    readonly subjectDigest: `sha256:${string}`;
    readonly caseId: string;
}
export interface WorkspaceInventoryReceipt {
    readonly checkout: string;
    readonly repos: readonly {
        readonly id: string;
        readonly receipts: readonly CaseInventoryReceipt[];
    }[];
    readonly files: readonly string[];
    readonly cases: readonly CollectedCase[];
    readonly unassignedCases: readonly {
        readonly executor: InventoryExecutor;
        readonly repo: string;
        readonly path: string;
        readonly project?: string;
        readonly titlePath: readonly string[];
    }[];
    readonly findings: readonly string[];
    readonly digest: `sha256:${string}`;
}
declare const WorkspaceInventoryError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "WorkspaceInventoryError";
} & Readonly<A>;
export declare class WorkspaceInventoryError extends WorkspaceInventoryError_base<{
    readonly detail: string;
    readonly receipt?: WorkspaceInventoryReceipt;
}> {
}
declare const DuplicateCollectedSubject_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "DuplicateCollectedSubject";
} & Readonly<A>;
/** A runner returned the same stable subject more than once; positional selection is unsafe. */
export declare class DuplicateCollectedSubject extends DuplicateCollectedSubject_base<{
    readonly subjectDigest: `sha256:${string}`;
    readonly subjects: readonly CollectedSubject[];
}> {
}
declare const DuplicateCollectedCaseId_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "DuplicateCollectedCaseId";
} & Readonly<A>;
export declare class DuplicateCollectedCaseId extends DuplicateCollectedCaseId_base<{
    readonly caseId: string;
    readonly subjects: readonly CollectedSubject[];
}> {
}
export declare const collectWorkspaceCaseInventory: (checkout: string) => Effect.Effect<{
    digest: `sha256:${string}`;
    checkout: string;
    repos: {
        id: string;
        receipts: {
            digest: `sha256:${string}`;
            files: string[];
            cases: {
                path: string;
                executor: InventoryExecutor;
                repo: string;
                project?: string;
                titlePath: readonly string[];
                caseId: string;
            }[];
            unassignedCases: {
                file: string;
                project?: string;
                titlePath: readonly string[];
            }[];
            executor: {
                readonly name: InventoryExecutor;
                readonly version: string;
            };
            repo: string;
            argv: readonly string[];
            checkout: string;
            bodyExecutions: 0;
            forbiddenSetupExecutions: 0;
            findings: readonly string[];
            exit: number | null;
            signal: string | null;
        }[];
    }[];
    files: string[];
    cases: CollectedCase[];
    unassignedCases: {
        titlePath: readonly string[];
        project?: string;
        executor: InventoryExecutor;
        repo: string;
        path: string;
    }[];
    findings: readonly string[];
}, import("./owned-process.js").OwnedProcessError | WorkspaceInventoryError | DuplicateCollectedSubject | DuplicateCollectedCaseId, FileSystem.FileSystem | import("effect/Scope").Scope | import("./owned-process.js").OwnedProcess>;
export declare const collectRepoCaseInventory: (repoId: string, checkout: string) => Effect.Effect<{
    digest: `sha256:${string}`;
    checkout: string;
    repos: {
        id: string;
        receipts: {
            digest: `sha256:${string}`;
            files: string[];
            cases: {
                path: string;
                executor: InventoryExecutor;
                repo: string;
                project?: string;
                titlePath: readonly string[];
                caseId: string;
            }[];
            unassignedCases: {
                file: string;
                project?: string;
                titlePath: readonly string[];
            }[];
            executor: {
                readonly name: InventoryExecutor;
                readonly version: string;
            };
            repo: string;
            argv: readonly string[];
            checkout: string;
            bodyExecutions: 0;
            forbiddenSetupExecutions: 0;
            findings: readonly string[];
            exit: number | null;
            signal: string | null;
        }[];
    }[];
    files: string[];
    cases: CollectedCase[];
    unassignedCases: {
        titlePath: readonly string[];
        project?: string;
        executor: InventoryExecutor;
        repo: string;
        path: string;
    }[];
    findings: readonly string[];
}, import("./owned-process.js").OwnedProcessError | WorkspaceInventoryError | DuplicateCollectedSubject | DuplicateCollectedCaseId, FileSystem.FileSystem | import("effect/Scope").Scope | import("./owned-process.js").OwnedProcess>;
export {};
