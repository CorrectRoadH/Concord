// @concord-file
// @concord-implements docs/engineering/code/architecture.md#operation-context
import { Context } from 'effect';
import type { WorkspaceMetadata } from '../workspace/index.ts';

/** Only Sources owns the observations and descriptors behind this scoped identity. */
export class SourceSnapshot extends Context.Service<SourceSnapshot, {
  readonly workspace: WorkspaceMetadata;
}>()('concord/base/sources/SourceSnapshot') {}
