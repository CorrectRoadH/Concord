import { createHash } from 'node:crypto';
import { Predicate, Schema } from 'effect';
import { ConcordError, decode, type MemoryMeta, type Resolution } from './shared.js';

export const NATIVE_RELIABILITY_POLICY = 'concord.native-reliability/v1' as const;
export type EvidenceRequirement = 'command' | typeof NATIVE_RELIABILITY_POLICY;

/** Historical native resolutions are a durable floor, including after reopen. */
export function memoryEvidenceRequirement(memory: MemoryMeta, project: EvidenceRequirement = 'command'): EvidenceRequirement {
  if (project === NATIVE_RELIABILITY_POLICY || memory.evidenceRequirement === NATIVE_RELIABILITY_POLICY ||
    [memory.resolution, ...memory.history.map(entry => entry.resolution)].some(value => value?.evidenceLevel === 'repository')) return NATIVE_RELIABILITY_POLICY;
  return 'command';
}
export function adoptMemoryEvidenceRequirement(memory: MemoryMeta, project: EvidenceRequirement = 'command'): MemoryMeta {
  return memory.memoryKind === 'problem' ? { ...memory, evidenceRequirement: memoryEvidenceRequirement(memory, project) } : memory;
}
export function usedMemoryInvocations(memory: MemoryMeta): readonly string[] {
  return [memory.resolution, ...memory.history.map(entry => entry.resolution)].flatMap(value => value?.evidenceLevel === 'repository' ? value.repositoryEvidence.cases.flatMap(item => item.invocationIds) : []);
}
export function assertMemoryResolutionPolicy(memory: MemoryMeta, resolution: Resolution, project: EvidenceRequirement = 'command'): void {
  if (resolution.kind !== 'fixed') return;
  if (memoryEvidenceRequirement(memory, project) === NATIVE_RELIABILITY_POLICY && resolution.evidenceLevel !== 'repository') throw new ConcordError('EvidenceRequirementUnsatisfied', 'This Problem requires concord.native-reliability/v1 evidence; command or attested evidence cannot close it');
  if (resolution.evidenceLevel === 'repository') {
    const evidence = resolution.repositoryEvidence;
    if (evidence.policy !== NATIVE_RELIABILITY_POLICY || evidence.epoch !== memory.epoch || evidence.cases.some(item => item.sourceIdentityDigest === undefined)) throw new ConcordError('InvalidProof', 'New fixed resolutions require current native policy, full source identity and Problem epoch binding');
    const invocations = evidence.cases.flatMap(item => item.invocationIds);
    if (new Set(invocations).size !== invocations.length || invocations.some(id => usedMemoryInvocations(memory).includes(id))) throw new ConcordError('InvalidProof', 'Native invocation identities are duplicated or already used by this Problem');
  }
}

const Text = Schema.String.check(Schema.isMinLength(1));
const Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
const Nat = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Path = Text.check(Schema.makeFilter(value => !value.startsWith('/') && !/[\\\0\r\n#]/u.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), { description: 'canonical repository relative path' }));
export const NativeCaseReceiptSchema = Schema.Struct({
  format: Schema.Literal('concord.native-case-receipt/v1'), mode: Schema.Literal('formal'),
  observation: Schema.Literals(['red', 'green', 'reliability']), selector: Text, caseId: Text, inventoryDigest: Digest,
  problem: Schema.Struct({ path: Path, epoch: Nat }),
  candidate: Schema.Struct({ gitSha: Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)), sha256: Hex, sri: Schema.String.check(Schema.isPattern(/^sha256-[A-Za-z0-9+/]{43}=$/u)) }),
  source: Schema.Unknown,
  runner: Schema.Struct({ executor: Text, version: Text, implementationDigest: Digest, argv: Schema.Array(Schema.String) }),
  result: Schema.Struct({ disposition: Schema.Literals(['regression', 'pass']), stage: Text, exitCode: Schema.NullOr(Schema.Int), signal: Schema.NullOr(Text), timedOut: Schema.Boolean, startupFailed: Schema.Boolean }),
  native: Schema.Struct({ copyId: Text, copyPath: Text, sequence: Positive, mode: Schema.Literals(['single', 'isolated', 'same', 'parallel']), caseCount: Positive, passed: Nat, failed: Nat, skipped: Nat, retries: Nat, parallelism: Positive }),
  cleanup: Schema.Struct({ ok: Schema.Boolean, resources: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
  invocationId: Text, receiptSha256: Hex,
});
export type NativeCaseReceipt = typeof NativeCaseReceiptSchema.Type;
export const NativeReliabilityCertificateSchema = Schema.Struct({
  format: Schema.Literal(NATIVE_RELIABILITY_POLICY), selector: Text, caseId: Text, candidateSha256: Hex, sourceDigest: Schema.String.check(Schema.isPattern(/^(?:sha256:)?[a-f0-9]{64}$/u)), greenReceipt: Path,
  observations: Schema.Struct({ isolatedCopies: Schema.Tuple([Path, Path, Path]), sameCopy: Schema.Tuple([Path, Path]), defaultParallel: Path, singleCase: Path, cleanup: Schema.Array(Path) }),
  certificateSha256: Hex,
});
export type NativeReliabilityCertificate = typeof NativeReliabilityCertificateSchema.Type;
export const NativeInventorySchema = Schema.Struct({
  executor: Schema.Struct({ name: Text, version: Text }), repo: Text, argv: Schema.Array(Schema.String), checkout: Text, files: Schema.Array(Path),
  cases: Schema.Array(Schema.Struct({ executor: Text, repo: Text, path: Path, project: Schema.optional(Text), titlePath: Schema.NonEmptyArray(Text), caseId: Text })),
  unassignedCases: Schema.Array(Schema.Struct({ file: Path, project: Schema.optional(Text), titlePath: Schema.Array(Schema.String) })),
  bodyExecutions: Nat, forbiddenSetupExecutions: Nat, findings: Schema.Array(Schema.Unknown), digest: Digest, exit: Schema.NullOr(Schema.Int), signal: Schema.NullOr(Text),
});
export const NativeEvidenceEntrySchema = Schema.Struct({ red: Schema.Struct({ path: Path, digest: Digest }), green: Schema.Struct({ path: Path, digest: Digest }), certificate: Schema.Struct({ path: Path, digest: Digest }), inventory: Schema.Struct({ path: Path, digest: Digest }) });
const IndexHistory = Schema.Union([
  Schema.Struct({ caseId: Text, memory: Path, evidence: NativeEvidenceEntrySchema, reason: Text, refreshedAtCommit: Text }),
  Schema.Struct({ caseId: Text, memory: Path, evidence: NativeEvidenceEntrySchema, reason: Text, retiredAtCommit: Text }),
]);
export const NativeEvidenceIndexSchema = Schema.Struct({ format: Schema.Literal('concord.case-evidence-index/v1'), current: Schema.Record(Schema.String, Schema.Record(Schema.String, NativeEvidenceEntrySchema)), history: Schema.optional(Schema.Array(IndexHistory)) });
export function decodeNativeEvidenceIndex(input: unknown, path: string) {
  if (Predicate.isObject(input) && input.format === 'niceeval.e2e-case-evidence-index/v1') throw new ConcordError('EvidenceMigrationRequired', `${path}: legacy native evidence index requires explicit offline migration; preserve original proof bytes`);
  return decode(NativeEvidenceIndexSchema, input, path);
}
export const canonicalEvidenceJson = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonicalEvidenceJson).join(',') + ']' : Predicate.isObject(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalEvidenceJson(value[key])).join(',') + '}' : JSON.stringify(value);
export const evidenceSignature = (value: unknown): string => createHash('sha256').update(canonicalEvidenceJson(value)).digest('hex');
const invalid = (message: string): never => { throw new ConcordError('NativeEvidenceInvalid', message); };
function signature(value: object, key: string, expected: string): void {
  const unsigned = Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
  if (evidenceSignature(unsigned) !== expected) invalid(`${key} integrity mismatch`);
}
export interface NativeSourceIdentity { readonly format: string; readonly caseId: string; readonly nativeTestFile: string; readonly projection: { readonly digest: string }; readonly binding: { readonly suiteId: string; readonly policy: string }; }
export interface NativeValidationContext<S extends NativeSourceIdentity> {
  readonly selector: string;
  readonly problem: { readonly path: string; readonly epoch: number };
  readonly currentSource: S;
  readonly implementationDigest: string;
  readonly decodeSource: (input: unknown) => S;
  readonly sameSource: (left: S, right: S) => boolean;
  readonly usedInvocations?: readonly string[];
}
export interface NativeEvidenceInput { readonly inventory: unknown; readonly red: unknown; readonly certificate: unknown; readonly receipts: ReadonlyMap<string, unknown>; }
/** One authoritative native gate for relation registration, refresh and fixed. */
export function validateNativeEvidence<S extends NativeSourceIdentity>(input: NativeEvidenceInput, context: NativeValidationContext<S>) {
  const inventory = decode(NativeInventorySchema, input.inventory, 'native inventory');
  signature(inventory, 'digest', inventory.digest.slice(7));
  if (inventory.exit !== 0 || inventory.signal !== null || inventory.findings.length || inventory.unassignedCases.length || inventory.bodyExecutions || inventory.forbiddenSetupExecutions) invalid('Inventory must prove clean collection without body or forbidden setup execution');
  if (new Set(inventory.cases.map(item => item.caseId)).size !== inventory.cases.length) invalid('Inventory has duplicate native case identities');
  for (const item of inventory.cases) if (item.executor !== inventory.executor.name || item.repo !== inventory.repo || !inventory.files.includes(item.path)) invalid('Inventory case disagrees with its runner, suite or file inventory');
  if (inventory.cases.filter(item => `${item.path}#${item.caseId}` === context.selector).length !== 1) invalid('Inventory must bind exactly one native case to the current selector');
  if (context.currentSource.format !== 'concord.repository-source-identity/v4' || `${context.currentSource.nativeTestFile}#${context.currentSource.caseId}` !== context.selector) invalid('Current source identity is not the selected v4 declaration');
  if (inventory.repo !== context.currentSource.binding.suiteId || context.currentSource.binding.policy !== NATIVE_RELIABILITY_POLICY) invalid('Inventory suite or source policy does not match the current configured suite');
  const certificate = decode(NativeReliabilityCertificateSchema, input.certificate, 'native reliability certificate');
  signature(certificate, 'certificateSha256', certificate.certificateSha256);
  const observations = certificate.observations;
  const reliabilityPaths = [...observations.isolatedCopies, ...observations.sameCopy, observations.defaultParallel];
  const greenPaths = [observations.singleCase, ...reliabilityPaths];
  if (new Set(greenPaths).size !== 7 || observations.cleanup.length !== 7 || new Set(observations.cleanup).size !== 7 || greenPaths.some(path => !observations.cleanup.includes(path)) || certificate.greenReceipt !== observations.singleCase) invalid('Reliability matrix requires seven distinct receipts with exact cleanup coverage');
  const receipt = (value: unknown, observation: NativeCaseReceipt['observation']) => {
    const decoded = decode(NativeCaseReceiptSchema, value, 'native receipt');
    signature(decoded, 'receiptSha256', decoded.receiptSha256);
    if (decoded.candidate.sri !== 'sha256-' + Buffer.from(decoded.candidate.sha256, 'hex').toString('base64')) invalid('Candidate SRI does not identify the candidate sha256 bytes');
    const source = context.decodeSource(decoded.source);
    if (decoded.selector !== context.selector || decoded.caseId !== context.currentSource.caseId || decoded.inventoryDigest !== inventory.digest || !context.sameSource(source, context.currentSource)) invalid('Receipt does not bind current source, selector and inventory');
    if (decoded.problem.path !== context.problem.path || decoded.problem.epoch !== context.problem.epoch) invalid('Receipt belongs to a different Problem or epoch');
    if (decoded.observation !== observation || !decoded.cleanup.ok || decoded.result.signal !== null || decoded.result.timedOut || decoded.result.startupFailed || /timeout|startup|cancel|signal/iu.test(decoded.result.stage)) invalid('Receipt has wrong observation, failed cleanup or abnormal termination');
    if (decoded.cleanup.resources.some(resource => ['ok', 'gone', 'processExited'].some(key => key in resource && resource[key] !== true))) invalid('Cleanup resource records contradict successful cleanup');
    const native = decoded.native;
    if (native.skipped || native.retries || native.passed + native.failed !== native.caseCount) invalid('Native observation contains skip/retry or inconsistent actual counts');
    if (observation === 'red') {
      if (decoded.result.disposition !== 'regression' || decoded.result.exitCode === null || decoded.result.exitCode <= 0 || native.failed !== 1 || native.passed !== 0) invalid('Red must observe one actual ordinary regression failure');
    } else if (decoded.result.disposition !== 'pass' || decoded.result.exitCode !== 0 || native.failed || native.passed !== native.caseCount) invalid('Green and reliability require successful actual native execution');
    if (observation !== 'reliability' && (native.mode !== 'single' || native.caseCount !== 1 || native.parallelism !== 1 || native.sequence !== 1)) invalid('Red and green require a single selected case');
    if (decoded.runner.implementationDigest !== context.implementationDigest) invalid("Native runner implementation changed; obtain new evidence");
    if (decoded.runner.executor !== inventory.executor.name || decoded.runner.version !== inventory.executor.version) invalid('Receipt runner differs from inventory runner');
    return { ...decoded, source };
  };
  const red = receipt(input.red, 'red');
  const green = receipt(input.receipts.get(certificate.greenReceipt), 'green');
  const reliability = reliabilityPaths.map(path => receipt(input.receipts.get(path), 'reliability'));
  if (certificate.selector !== context.selector || certificate.caseId !== green.caseId || certificate.candidateSha256 !== green.candidate.sha256 || certificate.sourceDigest !== green.source.projection.digest) invalid('Certificate does not bind current green source and candidate');
  if (reliability.some(item => canonicalEvidenceJson(item.candidate) !== canonicalEvidenceJson(green.candidate))) invalid('Reliability observations must use the green candidate');
  // argv may differ for the required parallel execution; executor/version are the runner identity.
  if ([red, ...reliability].some(item => item.runner.executor !== green.runner.executor || item.runner.version !== green.runner.version)) invalid('Runner identity differs across observations');
  const isolated = reliability.slice(0, 3);
  if (isolated.some(item => item.native.mode !== 'isolated' || item.native.sequence !== 1 || item.native.caseCount !== 1 || item.native.parallelism !== 1) || new Set(isolated.map(item => item.native.copyId)).size !== 3 || new Set(isolated.map(item => item.native.copyPath)).size !== 3) invalid('Isolated observations must prove three distinct fresh execution copies');
  const sameA = reliability[3]!.native, sameB = reliability[4]!.native;
  if (sameA.mode !== 'same' || sameB.mode !== 'same' || sameA.copyId !== sameB.copyId || sameA.copyPath !== sameB.copyPath || sameB.sequence !== sameA.sequence + 1 || sameA.caseCount !== 1 || sameB.caseCount !== 1 || sameA.parallelism !== 1 || sameB.parallelism !== 1) invalid('Same-copy observations must be consecutive actual executions on one copy');
  const parallel = reliability[5]!.native;
  if (parallel.mode !== 'parallel' || parallel.parallelism < 2) invalid('Default parallel observation must record actual parallel capacity');
  const invocationIds = [red, green, ...reliability].map(item => item.invocationId);
  if (new Set(invocationIds).size !== 8 || invocationIds.some(id => context.usedInvocations?.includes(id))) invalid('Eight invocation identities must be distinct and unused in this Problem history');
  return { inventory, red, green, certificate, reliability, reliabilityPaths, invocationIds, certificateObservations: observations };
}
