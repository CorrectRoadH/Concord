import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
import { type E2ERepoManifest } from "./manifest.ts";
export type { E2ERepoManifest, RepoRequires } from "./manifest.ts";
export interface DiscoveredRepo {
    readonly dir: string;
    readonly projectName: string;
    readonly manifest: E2ERepoManifest;
}
export interface DiscoveryResult {
    readonly repos: readonly DiscoveredRepo[];
    readonly errors: readonly string[];
}
declare const DiscoveryIoError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "DiscoveryIoError";
} & Readonly<A>;
export declare class DiscoveryIoError extends DiscoveryIoError_base<{
    readonly operation: "exists" | "read-directory" | "read-file" | "stat";
    readonly path: string;
    readonly cause: unknown;
}> {
}
export declare const ADAPTER_COLLECTION = "adapter";
export declare const repoRootDir: () => string;
export declare const e2eRootDir: () => string;
export declare const adapterRootDir: () => string;
export declare const canonicalRepoId: (projectRoot: string) => string;
export declare const e2eProjectName: (id: string) => string;
/** File discovery is effectful; validation failures are returned as diagnostics. */
export declare const discoverAllRepos: (e2eRoot: string) => Effect.Effect<DiscoveryResult, DiscoveryIoError, FileSystem.FileSystem>;
