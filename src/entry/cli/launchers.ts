import { Context, Effect } from "effect";
import type { ConcordError } from "../../model/index.js";

export interface ViewLaunchOptions { readonly root: string; readonly host: string; readonly port: number }
export interface ViewLaunchInfo {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly local: readonly string[]; readonly network: readonly string[];
}
export class ViewLauncher extends Context.Service<ViewLauncher, {
  readonly serve: (options: ViewLaunchOptions, ready: (server: ViewLaunchInfo) => void) => Effect.Effect<never, ConcordError>;
}>()('concord/cli/ViewLauncher') {}
export class LspLauncher extends Context.Service<LspLauncher, {
  readonly serve: (root: string | undefined) => Effect.Effect<void, ConcordError>;
}>()('concord/cli/LspLauncher') {}
