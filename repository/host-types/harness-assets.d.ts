import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
import type { HarnessAsset } from "./contracts.ts";
export interface MaterializedHarnessAssets {
    readonly assets: readonly HarnessAsset[];
    readonly environment: Readonly<Record<string, string>>;
}
declare const HarnessAssetMaterializationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "HarnessAssetMaterializationError";
} & Readonly<A>;
export declare class HarnessAssetMaterializationError extends HarnessAssetMaterializationError_base<{
    readonly asset: HarnessAsset;
    readonly operation: "check-destination" | "create-destination" | "copy" | "verify";
    readonly source: string;
    readonly destination: string;
    readonly detail: string;
}> {
}
/** Materialize only the closed set of harness assets declared by one Repo. */
export declare const materializeHarnessAssets: (checkoutRoot: string, isolatedRepo: string, assets: readonly HarnessAsset[]) => Effect.Effect<MaterializedHarnessAssets, HarnessAssetMaterializationError, FileSystem.FileSystem>;
/** Reconstruct the same environment for assets already present in a retained copy. */
export declare const inspectMaterializedHarnessAssets: (isolatedRepo: string, assets: readonly HarnessAsset[]) => Effect.Effect<MaterializedHarnessAssets, HarnessAssetMaterializationError, FileSystem.FileSystem>;
export {};
