import { Schema } from 'effect';

export const WorkspaceWait = Schema.Struct({ operation: Schema.Literal('workspace-wait'), changed: Schema.Boolean, sourceDigest: Schema.NullOr(Schema.String) });
export type WorkspaceWait = typeof WorkspaceWait.Type;
