import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
import { type DiscoveryIoError, type DiscoveredRepo } from "./discovery.ts";
import type { E2ERepoManifest, RepoRequires } from "./manifest.ts";
export interface MatrixEntry {
    readonly id: string;
    readonly batch: E2ERepoManifest["batch"];
    readonly dir: string;
    readonly areas: E2ERepoManifest["areas"];
    readonly lanes: E2ERepoManifest["lanes"];
    readonly executor: E2ERepoManifest["executor"];
    readonly requires?: RepoRequires;
}
export interface ListedRepos {
    readonly repos: readonly DiscoveredRepo[];
    readonly errors: readonly string[];
}
export declare const listRepos: (root?: string) => Effect.Effect<ListedRepos, DiscoveryIoError, FileSystem.FileSystem>;
/** Rendering is pure; the final CLI handler supplies stdout/stderr. */
export declare const formatListedRepos: (listed: ListedRepos, json: boolean, root?: string) => readonly string[];
