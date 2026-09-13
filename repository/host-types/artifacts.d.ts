import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
declare const ArtifactCollectionError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ArtifactCollectionError";
} & Readonly<A>;
export declare class ArtifactCollectionError extends ArtifactCollectionError_base<{
    readonly detail: string;
}> {
}
export declare const repoArtifactDir: (artifactRoot: string, repoId: string) => string;
export declare const repoReceiptPath: (artifactRoot: string, repoId: string) => string;
export interface CollectResult {
    readonly collected: readonly string[];
    readonly warnings: readonly string[];
}
export declare const collectArtifacts: (copyDir: string, destDir: string, patterns: readonly string[]) => Effect.Effect<CollectResult, ArtifactCollectionError, FileSystem.FileSystem>;
export declare const describeCollected: (destDir: string, path: string) => string;
export declare const isDiagnosticNiceevalPattern: (pattern: string) => boolean;
export {};
