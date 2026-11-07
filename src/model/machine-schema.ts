// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#机器可读-schema
// @concord-implements docs/feature/local-sdlc/use-case/run-tests-with-own-runner.md#schema
import { Schema } from 'effect';
import { ConcordError, ProjectSchema, Text, DocumentSchema, AnnotatedCaseSchema, IssueRelationSchema, MemoryRelationSchema } from './shared.ts';
import { WorkspaceWait } from './herdr-mod/index.ts';
import { WorkspaceProjectionSnapshotSchema } from './workspace-projection.ts';
import { ChangePreviewSchema } from './change-preview.ts';
import { ADAPTER_FORMAT, ContextSchema, PayloadSchemas, ResponseSchemas } from './test-adapter-protocol.ts';

const operations = ['collect-plan', 'collect-parse', 'select-plan', 'report-parse'] as const;
const adapter = Schema.Union(operations.flatMap(op => [
  Schema.Struct({ format: Schema.Literal(ADAPTER_FORMAT), op: Schema.Literal(op), requestId: Text, context: ContextSchema, payload: PayloadSchemas[op] }),
  Schema.Struct({ format: Schema.Literal(ADAPTER_FORMAT), op: Schema.Literal(op), requestId: Text, planId: Text, inputs: Text, payload: ResponseSchemas[op] }),
]));
const model = Schema.Union([
  ...DocumentSchema.members.map(member => Schema.Struct({ ...member.fields, path: Schema.optional(Text) })),
  AnnotatedCaseSchema, IssueRelationSchema, MemoryRelationSchema,
  Schema.Struct({ ...WorkspaceProjectionSnapshotSchema.fields.documents.value.fields, body: Schema.optional(Schema.String) }),
  WorkspaceProjectionSnapshotSchema.fields.edges.value,
  WorkspaceProjectionSnapshotSchema.fields.findings.value,
  Schema.Struct({
    ...WorkspaceProjectionSnapshotSchema.fields.diagnostics.members[1].fields,
    details: Schema.optional(Schema.Json), complete: Schema.optional(Schema.Boolean),
  }),
]);
const schemas = { config: ProjectSchema, 'test-adapter': adapter, 'change-preview': ChangePreviewSchema, model, 'workspace-wait': WorkspaceWait };
export const machineSchemaNames = Object.keys(schemas);
export function machineSchema(name: string) {
  if (!Object.hasOwn(schemas, name)) throw new ConcordError('SchemaNotFound', `Unknown schema: ${name}`, { available: machineSchemaNames });
  const document = Schema.toJsonSchemaDocument(schemas[name as keyof typeof schemas], { onExcessProperty: 'error' });
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...document.schema, ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}) };
}
