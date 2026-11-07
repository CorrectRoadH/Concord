// @concord-file
// @concord-implements docs/engineering/code/architecture.md#operation-context
import { Context } from 'effect';
import type { ConfigSnapshot, ResolvedProjectConfig } from '../../model/index.ts';

export interface WorkspaceMetadata {
  readonly root: string;
  readonly privateDir: string;
  readonly configuration: ConfigSnapshot;
  readonly config: ResolvedProjectConfig;
  readonly access: 'read' | 'write';
  readonly cache: 'use' | 'off';
}

export interface WorkspaceOpenOptions {
  readonly access: 'read' | 'write';
  readonly cache: 'use' | 'off';
}

/** Metadata is captured for one operation and grants no publication capability. */
export class WorkspaceContext extends Context.Service<WorkspaceContext, WorkspaceMetadata>()('concord/base/workspace/WorkspaceContext') {}
