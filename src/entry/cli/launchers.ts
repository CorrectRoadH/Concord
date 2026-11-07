import type { WorkspaceWait } from '../../model/herdr-mod/index.ts';
import type * as ModelTypes from '../../model/index.ts';
import type { Effect, Stdio } from "effect";
import { Context } from "effect";
import type { ConcordError } from "../../model/index.ts";

export const QueryServerMode = Context.Reference<'shared' | 'command'>('concord/cli/QueryServerMode', { defaultValue: () => 'shared' });

export interface ViewLaunchOptions { readonly root: string; readonly host: string; readonly port: number; readonly inProcess?: boolean }
export interface ViewLaunchInfo {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly local: readonly string[]; readonly network: readonly string[];
}
export class ViewLauncher extends Context.Service<ViewLauncher, {
  readonly serve: (options: ViewLaunchOptions, ready: (server: ViewLaunchInfo) => Effect.Effect<void, unknown, Stdio.Stdio>) => Effect.Effect<unknown, ConcordError, Stdio.Stdio>;
}>()('concord/cli/ViewLauncher') {}
export class LspLauncher extends Context.Service<LspLauncher, {
  readonly serve: (root: string | undefined) => Effect.Effect<number, ConcordError>;
}>()('concord/cli/LspLauncher') {}
export class ServerLauncher extends Context.Service<ServerLauncher, {
  readonly processIdentity: Effect.Effect<{ readonly pid: number; readonly installation: string }, ConcordError>;
  readonly run: (root: string) => Effect.Effect<void, unknown>;
  readonly start: (root: string) => Effect.Effect<unknown, unknown>;
  readonly stop: (root: string) => Effect.Effect<unknown, unknown>;
  readonly status: (root: string) => Effect.Effect<unknown, unknown>;
  readonly projection: (root: string) => Effect.Effect<ModelTypes.WorkspaceProjection | undefined, unknown>;
  readonly wait: (root: string, after: string | undefined, timeout: number) => Effect.Effect<WorkspaceWait, ConcordError>;
  readonly clear: (root: string) => Effect.Effect<unknown, unknown>;
  readonly cache: (root: string, action: 'cache-status' | 'cache-rebuild') => Effect.Effect<unknown, ConcordError>;
  readonly withCache: <A, E, R>(root: string | undefined, operation: Effect.Effect<A, E, R>, required?: boolean) => Effect.Effect<A, E | ConcordError, R>;
}>()('concord/cli/ServerLauncher') {}
