// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
import { Effect, Predicate, Result, Schema } from 'effect';
import { governanceSuiteForFile } from 'concord-sdlc/governance-config';
import { deriveTestReference } from 'concord-sdlc/model';
import { decodeChangePreview } from 'concord-sdlc/change-preview';
import {
  NativeCaseReceiptSchema, NativeReliabilityCertificateSchema,
  evidenceSignature,
} from 'concord-sdlc/evidence-policy';
import { repositoryImplementationDigest } from './identity.js';
import { repositoryAdapterSnapshot } from './adapter-identity.js';
import { CaseInventorySchema, WorkspaceInventorySchema, repositoryProtocolJson } from './process-protocol.js';
import {
  decodeRepositorySourceIdentityV4, projectExecutionSources,
  resolveRepositorySourceIdentity, sameRepositorySourceIdentity,
} from './source-identity.js';
import { decodeAnnotatedCases, locateSupportedTestDeclarations } from './docs/test-case/annotations.js';

export const REPOSITORY_ENGINE_FORMAT = 'concord.repository-engine/v1' as const;
export const REPOSITORY_ENGINE_BYTES = 32 * 1024 * 1024;

export class RepositoryEngineRequestInvalid extends Schema.TaggedError<RepositoryEngineRequestInvalid>()('RepositoryEngineRequestInvalid', {
  message: Schema.String,
}) {}

const Text = Schema.String.check(Schema.isMinLength(1));
const Action = Schema.Literals(['sign', 'validate']);
// Struct({}) accepts more than an empty JSON object in the pinned Effect release.
const EmptyPayload = Schema.Unknown.check(Schema.makeFilter(
  value => Predicate.isObject(value) && Object.keys(value).length === 0,
  { identifier: 'EmptyRepositoryEnginePayload' },
));
const request = <Op extends string, Fields extends Schema.Struct.Fields>(op: Op, fields: Fields) => Schema.Struct({
  format: Schema.Literal(REPOSITORY_ENGINE_FORMAT), requestId: Text,
  op: Schema.Literal(op), payload: Schema.Struct(fields),
});

export const RepositoryEngineRequestSchema = Schema.Union([
  request('identity', {}).mapFields(fields => ({ ...fields, payload: EmptyPayload })),
  request('suite', { file: Text }),
  request('source', { selector: Text }),
  request('source-validate', { value: Schema.Unknown }),
  request('same-source', { left: Schema.Unknown, right: Schema.Unknown }),
  request('projection', { directory: Text, suiteRoot: Text }),
  request('declarations', { file: Text, source: Schema.String }),
  request('case-id', { nativePath: Text, declarationPath: Text, title: Schema.String }),
  request('inventory', { kind: Schema.Literals(['case', 'workspace']), action: Action, value: Schema.Unknown }),
  request('preview', { value: Schema.Unknown }),
  request('receipt', { action: Action, value: Schema.Unknown }),
  request('certificate', { action: Action, value: Schema.Unknown }),
]);

const decode = <A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A =>
  Schema.decodeUnknownSync(schema, { errors: 'all', onExcessProperty: 'error' })(value);
const invalid = (message: string): never => { throw new RepositoryEngineRequestInvalid({ message }); };

/** Only the signature field is removed; the shared evidence owner controls encoding. */
function signed<A extends object>(
  schema: Schema.ConstraintDecoder<A, never>, unsignedSchema: Schema.ConstraintDecoder<object, never>,
  key: string, action: 'sign' | 'validate', value: unknown, prefix = '',
): A {
  if (action === 'sign') {
    const unsigned = decode(unsignedSchema, value);
    return decode(schema, { ...unsigned, [key]: prefix + evidenceSignature(unsigned) });
  }
  const decoded = decode(schema, value);
  const unsigned = Object.fromEntries(Object.entries(decoded).filter(([name]) => name !== key));
  if (Reflect.get(decoded, key) !== prefix + evidenceSignature(unsigned)) invalid(`${key} integrity mismatch`);
  return decoded;
}

const UnsignedReceipt = NativeCaseReceiptSchema.mapFields(({ receiptSha256: _, ...fields }) => fields);
const UnsignedCertificate = NativeReliabilityCertificateSchema.mapFields(({ certificateSha256: _, ...fields }) => fields);
const UnsignedInventory = CaseInventorySchema.mapFields(({ digest: _, ...fields }) => fields);
const UnsignedWorkspaceInventory = WorkspaceInventorySchema.mapFields(({ digest: _, ...fields }) => fields);

function inventory(action: 'sign' | 'validate', value: unknown) {
  return signed(CaseInventorySchema, UnsignedInventory, 'digest', action, value, 'sha256:');
}

function workspaceInventory(action: 'sign' | 'validate', value: unknown) {
  const workspace = signed(WorkspaceInventorySchema, UnsignedWorkspaceInventory, 'digest', action, value, 'sha256:');
  for (const repo of workspace.repos) for (const receipt of repo.receipts) inventory('validate', receipt);
  return workspace;
}

function receipt(action: 'sign' | 'validate', value: unknown) {
  const result = signed(NativeCaseReceiptSchema, UnsignedReceipt, 'receiptSha256', action, value);
  const source = decodeRepositorySourceIdentityV4(result.source);
  if (source.caseId !== result.caseId || `${source.nativeTestFile}#${source.caseId}` !== result.selector) {
    invalid('Receipt source disagrees with its selector or case identity');
  }
  return { ...result, source };
}

/** Pure governance composition. No host capability, runner or publication owner. */
export const repositoryEngine = Effect.fn('repositoryEngine')(function*(root: string, source: string) {
  return yield* Effect.try({
    try: () => {
      let input: unknown;
      try { input = repositoryProtocolJson(source); }
      catch { return invalid('Expected one bounded JSON request without duplicate keys'); }
      const call = decode(RepositoryEngineRequestSchema, input);
      const implementationDigest = repositoryImplementationDigest();
      const result = (() => {
        switch (call.op) {
          case 'identity': return { implementationDigest, adapterDigest: repositoryAdapterSnapshot(root)?.digest ?? null };
          case 'suite': {
            const { id, root: suiteRoot } = governanceSuiteForFile(root, call.payload.file);
            return { id, root: suiteRoot };
          }
          case 'source': return resolveRepositorySourceIdentity(root, call.payload.selector);
          case 'source-validate': return decodeRepositorySourceIdentityV4(call.payload.value);
          case 'same-source': return { same: sameRepositorySourceIdentity(
            decodeRepositorySourceIdentityV4(call.payload.left), decodeRepositorySourceIdentityV4(call.payload.right),
          ) };
          case 'projection': return projectExecutionSources(call.payload.directory, call.payload.suiteRoot);
          case 'declarations': {
            const annotated = decodeAnnotatedCases(call.payload.file, call.payload.source);
            if (Result.isFailure(annotated)) throw annotated.failure;
            return { annotated: annotated.success, supported: locateSupportedTestDeclarations(call.payload.file, call.payload.source) };
          }
          case 'case-id': return deriveTestReference(call.payload.nativePath, call.payload.declarationPath, call.payload.title);
          case 'inventory': return call.payload.kind === 'case'
            ? inventory(call.payload.action, call.payload.value)
            : workspaceInventory(call.payload.action, call.payload.value);
          case 'preview': return decodeChangePreview(call.payload.value);
          case 'receipt': return receipt(call.payload.action, call.payload.value);
          case 'certificate': return signed(NativeReliabilityCertificateSchema, UnsignedCertificate, 'certificateSha256', call.payload.action, call.payload.value);
        }
      })();
      const response = JSON.stringify({ format: REPOSITORY_ENGINE_FORMAT, requestId: call.requestId, op: call.op, implementationDigest, result });
      // Apply the same structural and byte budget to the complete output envelope.
      if (Buffer.byteLength(response) > REPOSITORY_ENGINE_BYTES) return invalid('Engine response exceeds 32 MiB');
      try { repositoryProtocolJson(response); }
      catch { return invalid('Engine response exceeds the JSON structural budget'); }
      return response;
    },
    catch: (cause) => cause,
  });
});

export function repositoryEngineFailure(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Engine request failed';
  const code = Predicate.isObject(cause) && typeof cause._tag === 'string' && cause._tag !== 'SchemaError' ? cause._tag
    : Predicate.isObject(cause) && typeof cause.code === 'string' ? cause.code
    : cause instanceof Error && /^RepositoryAdapter\w+$/u.test(cause.name) ? cause.name
    : /^(SourceIdentity\w+|SourceProjection\w+):/u.exec(message)?.[1]
      ?? 'RepositoryEngineRequestInvalid';
  return { ok: false as const, error: code, message };
}
