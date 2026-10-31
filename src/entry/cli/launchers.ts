import { Context, Effect } from "effect";
import type { ConcordError } from "../../model/index.js";

export interface ViewLaunchOptions { readonly root: string; readonly host: string; readonly port: number; readonly inProcess?: boolean }
export interface ViewLaunchInfo {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly local: readonly string[]; readonly network: readonly string[];
}
export class ViewLauncher extends Context.Service<ViewLauncher, {
  readonly serve: (options: ViewLaunchOptions, ready: (server: ViewLaunchInfo) => void) => Effect.Effect<unknown, ConcordError>;
}>()('concord/cli/ViewLauncher') {}
export class LspLauncher extends Context.Service<LspLauncher, {
  readonly serve: (root: string | undefined) => Effect.Effect<void, ConcordError>;
}>()('concord/cli/LspLauncher') {}
export class ServerLauncher extends Context.Service<ServerLauncher, {
  readonly run: (root: string) => Effect.Effect<void, unknown>;
  readonly start: (root: string) => Effect.Effect<unknown, unknown>;
  readonly stop: (root: string) => Effect.Effect<unknown, unknown>;
  readonly status: (root: string) => Effect.Effect<unknown, unknown>;
  readonly projection: (root: string) => Effect.Effect<import('../../model/index.js').WorkspaceProjection | undefined, unknown>;
  readonly clear: (root: string) => Effect.Effect<unknown, unknown>;
}>()('concord/cli/ServerLauncher') {}
