// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
import { Predicate, Schema } from 'effect';
import { NativeCaseReceiptSchema, NativeInventorySchema, NativeReliabilityCertificateSchema } from 'concord-sdlc/evidence-policy';
import { protocolJson } from 'concord-sdlc/test-adapter-protocol';
import { RepositoryProfileError } from './root.js';
import { RepositorySourceIdentityV4Schema, decodeRepositorySourceIdentityV4 } from './source-identity.js';

export const REPOSITORY_ADAPTER_FORMAT = 'concord.repository-adapter/v1' as const;
export const REPOSITORY_PROTOCOL_BYTES = 32 * 1024 * 1024;
const Text = Schema.String.check(Schema.isMinLength(1));
const Digest = Schema.TemplateLiteral(['sha256:', Schema.String]).check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
export const RepositoryGuardPathSchema = Text.check(Schema.makeFilter(path => !path.startsWith('/') && !/[\\\0\r\n#]/u.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')));
export const RepositoryAdapterGuardSchema = Schema.Struct({ path: RepositoryGuardPathSchema, digest: Digest });
export type RepositoryAdapterGuard = typeof RepositoryAdapterGuardSchema.Type;

const uniqueCases = (cases: readonly { readonly caseId: string }[]) => new Set(cases.map(item => item.caseId)).size === cases.length;
export const CaseInventorySchema = Schema.Struct({
  ...NativeInventorySchema.fields,
  cases: Schema.Array(Schema.Struct({ ...NativeInventorySchema.fields.cases.value.fields, project: Schema.optionalKey(Text) })),
  unassignedCases: Schema.Array(Schema.Struct({ ...NativeInventorySchema.fields.unassignedCases.value.fields, project: Schema.optionalKey(Text) })),
  digest: Digest,
  bodyExecutions: Schema.Literal(0), forbiddenSetupExecutions: Schema.Literal(0), findings: Schema.Array(Schema.String),
}).check(Schema.makeFilter(value => uniqueCases(value.cases)));
export const WorkspaceInventorySchema = Schema.Struct({
  checkout: Text,
  repos: Schema.Array(Schema.Struct({ id: Text, receipts: Schema.Array(CaseInventorySchema) })),
  files: NativeInventorySchema.fields.files,
  cases: CaseInventorySchema.fields.cases,
  unassignedCases: Schema.Array(Schema.Struct({ executor: Text, repo: Text, path: RepositoryGuardPathSchema, project: Schema.optionalKey(Text), titlePath: Schema.Array(Schema.String) })),
  findings: Schema.Array(Schema.String), digest: Digest,
}).check(Schema.makeFilter(value => uniqueCases(value.cases) && uniqueCases(value.repos.flatMap(repo => repo.receipts.flatMap(receipt => receipt.cases))) && new Set(value.repos.map(repo => repo.id)).size === value.repos.length));

// Keep the domain schemas authoritative, strengthening their Unknown fields at the wire boundary.
export const RepositoryNativeReceiptSchema = Schema.Struct({
  ...NativeCaseReceiptSchema.fields,
  source: RepositorySourceIdentityV4Schema,
  cleanup: Schema.Struct({ ok: Schema.Boolean, resources: Schema.Array(Schema.Record(Schema.String, Schema.Json)) }),
});
export const RepositoryAdapterPayloadSchemas = {
  'collect-repo': Schema.Struct({ suiteId: Text, checkout: Text }),
  'collect-workspace': Schema.Struct({ checkout: Text }),
  'read-inventory': Schema.Struct({ inventoryId: Text, selector: Text }),
  'read-red': Schema.Struct({ id: Text }),
  'read-takeover': Schema.Struct({ id: Text }),
} as const;
export const RepositoryAdapterResultSchemas = {
  'collect-repo': WorkspaceInventorySchema,
  'collect-workspace': WorkspaceInventorySchema,
  'read-inventory': CaseInventorySchema,
  'read-red': Schema.Struct({ id: Text, receipt: RepositoryNativeReceiptSchema, candidatePath: RepositoryGuardPathSchema }),
  'read-takeover': Schema.Struct({
    id: Text, certificate: NativeReliabilityCertificateSchema,
    receipts: Schema.Array(Schema.Struct({ key: RepositoryGuardPathSchema, receipt: RepositoryNativeReceiptSchema })).check(Schema.makeFilter(values => new Set(values.map(value => value.key)).size === values.length)),
    candidatePath: RepositoryGuardPathSchema,
  }),
} as const;
export type RepositoryAdapterOp = keyof typeof RepositoryAdapterPayloadSchemas;
export type RepositoryAdapterResult<O extends RepositoryAdapterOp> = typeof RepositoryAdapterResultSchemas[O]['Type'];

export function repositoryProtocolDecode<A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A {
  try { return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error', errors: 'all' })(value); }
  catch (cause) { throw new RepositoryProfileError('RepositoryAdapterInvalid', `Invalid repository protocol: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

/** Retain the shared lexical duplicate-key/depth checks and apply repository budgets. */
export function repositoryProtocolJson(source: string): unknown {
  try {
    const value = protocolJson(source, REPOSITORY_PROTOCOL_BYTES);
    const pending: unknown[] = [value];
    let nodes = 0;
    while (pending.length > 0) {
      const item = pending.pop();
      if (++nodes > 200_000) throw new Error('JSON exceeds 200000 nodes');
      if (Array.isArray(item)) {
        if (item.length > 50_000) throw new Error('JSON array exceeds 50000 items');
        for (const child of item) pending.push(child);
      } else if (Predicate.isObject(item)) {
        for (const child of Object.values(item)) pending.push(child);
      }
    }
    return value;
  } catch (cause) { throw new RepositoryProfileError('RepositoryAdapterInvalid', `Invalid repository JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

export function repositoryAdapterResponseSchema(op: RepositoryAdapterOp) {
  return Schema.Struct({
    format: Schema.Literal(REPOSITORY_ADAPTER_FORMAT), requestId: Text, root: Text,
    op: Schema.Literal(op), engineDigest: Digest,
    result: Schema.Json, guards: Schema.Array(RepositoryAdapterGuardSchema),
  });
}

export function validateRepositoryAdapterSources(op: RepositoryAdapterOp, result: unknown): void {
  if (op === 'read-red') {
    const value = repositoryProtocolDecode(RepositoryAdapterResultSchemas['read-red'], result);
    decodeRepositorySourceIdentityV4(value.receipt.source);
  } else if (op === 'read-takeover') {
    const value = repositoryProtocolDecode(RepositoryAdapterResultSchemas['read-takeover'], result);
    for (const item of value.receipts) decodeRepositorySourceIdentityV4(item.receipt.source);
  }
}

export function freezeRepositoryAdapterJson<A>(value: A): A {
  if (Array.isArray(value) || Predicate.isObject(value)) {
    for (const child of Object.values(value)) freezeRepositoryAdapterJson(child);
    Object.freeze(value);
  }
  return value;
}
