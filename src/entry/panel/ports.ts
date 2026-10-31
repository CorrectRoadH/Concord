import type { Effect } from 'effect';
import type { WorkspaceDisplay } from '../../model/workspace-display/index.js';
import type { BoundPanelBody } from './layout.js';
import type { PanelState } from './state.js';
export interface PanelGeneration { readonly model: WorkspaceDisplay }
export interface PanelReadResult { readonly path: string; readonly digest: string; readonly body: string }
export interface PanelPorts {
  readonly read: (request: { readonly path: string; readonly expectedDigest: string }) => Effect.Effect<PanelReadResult, Error>;
  readonly openInWeb: (path: string) => Effect.Effect<string, Error>;
}
export interface PanelSession {
  readonly update: (generation: PanelGeneration | undefined, reconnecting?: boolean) => Effect.Effect<void>;
  readonly closed: Effect.Effect<void, unknown>;
}
export interface PanelFirstFrame { readonly state: PanelState; readonly bodies: ReadonlyMap<string, BoundPanelBody> }
