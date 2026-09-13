import { Result } from "effect";
import { AREAS, BROWSERS, HARNESS_ASSETS, HOST_CAPABILITIES, LANES, PLATFORMS, type Manifest, type ManifestMetadata } from "./contracts.ts";
export declare const SCHEMA_VERSION: 3;
export { AREAS, BROWSERS, HARNESS_ASSETS, HOST_CAPABILITIES, LANES, PLATFORMS };
export type { Area, BatchId, Browser, HarnessAsset, HostCapability, Lane, Platform } from "./contracts.ts";
export type Executor = ManifestMetadata["executor"];
export type RepoRequires = NonNullable<ManifestMetadata["requires"]>;
export type RepoHarness = NonNullable<ManifestMetadata["harness"]>;
export type E2ERepoManifest = Manifest;
export type ManifestParseResult = Result.Result<ManifestMetadata, import("./contracts.ts").ContractDecodeError>;
/** A scenario id is a canonical, contained artifact-relative path. */
export declare const isCanonicalRelativePath: (value: string) => boolean;
/** Stable and directly reusable in matrix, artifact, and diagnostic ids. */
export declare const isCanonicalBatchId: (value: string) => boolean;
/** Keeps the legacy diagnostic helper while delegating its grammar to Schema. */
export declare const artifactPatternError: (value: string) => string | undefined;
/** Strictly decode one targets.e2e.metadata.niceeval document. */
export declare const parseManifest: (raw: unknown) => ManifestParseResult;
export declare const formatManifestError: (source: string, error: import("./contracts.ts").ContractDecodeError) => string;
