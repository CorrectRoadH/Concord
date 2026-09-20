import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { Result, Schema } from 'effect';
import {
  governanceSuiteForFile,
  readGovernanceConfiguration,
  type GovernanceConfigurationSnapshot,
} from 'concord-sdlc/governance-config';
import { decodeAnnotatedCases, stripManagedCaseAnnotations } from './docs/test-case/annotations.js';

export const SOURCE_PROJECTION_ALGORITHM = 'concord.repository-source-projection/v3' as const;
export const SOURCE_IDENTITY_FORMAT = 'concord.repository-source-identity/v4' as const;
export const SOURCE_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']);
export const SOURCE_EXCLUDED_BASENAMES = new Set(['node_modules', '.git']);

export interface SourceProjectionFile {
  readonly path: string;
  readonly bytes: number;
  readonly rawSha256: string;
  readonly codeSha256: string;
}

export interface SourceProjectionV3 {
  readonly algorithm: typeof SOURCE_PROJECTION_ALGORITHM;
  readonly digest: string;
  readonly files: readonly SourceProjectionFile[];
}

export interface RepositorySourceIdentityV4 {
  readonly format: typeof SOURCE_IDENTITY_FORMAT;
  readonly projection: SourceProjectionV3;
  readonly caseId: string;
  readonly nativeTestFile: string;
  readonly declarationFile: string;
  readonly binding: {
    readonly kind: 'direct-contract';
    readonly suiteId: string;
    readonly contractRef: string;
    readonly contractSha256: string;
    readonly policy: 'concord.native-reliability/v1';
    readonly configurationDigest: string;
    readonly adapterSourceDigest: string | null;
  };
}

const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const Sha256Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u));
const ProjectionPath = Schema.String.check(Schema.makeFilter(path => path.length > 0
  && !path.startsWith('/') && !path.includes('\\')
  && path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..'),
{ identifier: 'CanonicalProjectionPath' }));
export const SourceProjectionFileSchema = Schema.Struct({
  path: ProjectionPath,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rawSha256: Sha256Hex,
  codeSha256: Sha256Hex,
});
export const SourceProjectionV3Schema = Schema.Struct({
  algorithm: Schema.Literal(SOURCE_PROJECTION_ALGORITHM),
  digest: Sha256Digest,
  files: Schema.Array(SourceProjectionFileSchema),
});
export const RepositorySourceIdentityV4Schema = Schema.Struct({
  format: Schema.Literal(SOURCE_IDENTITY_FORMAT),
  projection: SourceProjectionV3Schema,
  caseId: Schema.String.check(Schema.isPattern(/^neref_[0-9a-f]{32}$/u)),
  nativeTestFile: ProjectionPath,
  declarationFile: ProjectionPath,
  binding: Schema.Struct({
    kind: Schema.Literal('direct-contract'),
    suiteId: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/u)),
    contractRef: ProjectionPath,
    contractSha256: Sha256Hex,
    policy: Schema.Literal('concord.native-reliability/v1'),
    configurationDigest: Sha256Digest,
    adapterSourceDigest: Schema.NullOr(Sha256Digest),
  }),
});

const sha256Hex = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256Digest = (bytes: string | Uint8Array): string => `sha256:${sha256Hex(bytes)}`;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const slash = (path: string): string => path.split(sep).join('/');
const repositoryPath = (root: string, path: string): string => slash(relative(resolve(root), resolve(path)));
const extension = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

function configuration(root: string): GovernanceConfigurationSnapshot {
  const snapshot = readGovernanceConfiguration(root);
  if (snapshot === undefined) throw new Error('SourceIdentityConfigurationMissing: concord.repository.json is required');
  return snapshot;
}

function assertProjectionPaths(projection: SourceProjectionV3): void {
  const paths = projection.files.map(file => file.path);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => index > 0 && paths[index - 1]!.localeCompare(path) >= 0)) {
    throw new Error('SourceIdentityInvalid: projection paths must be unique and strictly sorted');
  }
}

export function decodeSourceProjectionV3(input: unknown): SourceProjectionV3 {
  let projection: SourceProjectionV3;
  try { projection = Schema.decodeUnknownSync(SourceProjectionV3Schema, { errors: 'all', onExcessProperty: 'error' })(input); }
  catch (cause) { throw new Error(`SourceIdentityInvalid: ${cause instanceof Error ? cause.message : String(cause)}`); }
  assertProjectionPaths(projection);
  const digest = sha256Digest(canonicalJson({
    algorithm: SOURCE_PROJECTION_ALGORITHM,
    files: projection.files.map(({ path, codeSha256 }) => ({ path, codeSha256 })),
  }));
  if (projection.digest !== digest) throw new Error(`SourceIdentityInvalid: projection digest mismatch; expected ${digest}`);
  return projection;
}

export function decodeRepositorySourceIdentityV4(input: unknown): RepositorySourceIdentityV4 {
  let identity: RepositorySourceIdentityV4;
  try { identity = Schema.decodeUnknownSync(RepositorySourceIdentityV4Schema, { errors: 'all', onExcessProperty: 'error' })(input); }
  catch (cause) { throw new Error(`SourceIdentityInvalid: ${cause instanceof Error ? cause.message : String(cause)}`); }
  const projection = decodeSourceProjectionV3(identity.projection);
  const paths = new Set(projection.files.map(file => file.path));
  if (!paths.has(identity.nativeTestFile) || !paths.has(identity.declarationFile)) {
    throw new Error('SourceIdentityInvalid: native test and declaration files must belong to the signed suite projection');
  }
  const referenceParts = identity.binding.contractRef.split('#');
  if (referenceParts.length > 2 || referenceParts[0]?.length === 0 || (referenceParts.length === 2 && referenceParts[1]?.length === 0)) {
    throw new Error('SourceIdentityInvalid: contractRef must be one canonical path with at most one non-empty anchor');
  }
  return { ...identity, projection };
}

/** Project a physical execution copy into the original suite namespace.
 * This observes source bytes only; governance/contract binding stays in the identity builder.
 */
export function projectExecutionSources(directory: string, suiteRoot: string): SourceProjectionV3 {
  Schema.decodeUnknownSync(ProjectionPath)(suiteRoot);
  const absoluteSuite = resolve(directory);
  const suiteStatus = lstatSync(absoluteSuite);
  if (!suiteStatus.isDirectory() || suiteStatus.isSymbolicLink()) throw new Error('SourceProjectionUnsupported: execution source must be a regular directory');
  const files: SourceProjectionFile[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (SOURCE_EXCLUDED_BASENAMES.has(name)) continue;
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      const relativePath = `${suiteRoot}/${repositoryPath(absoluteSuite, path)}`;
      if (stat.isSymbolicLink()) throw new Error(`SourceProjectionUnsupported: source projection rejects symlink ${relativePath}`);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile()) throw new Error(`SourceProjectionUnsupported: source projection rejects special file ${relativePath}`);
      if (!SOURCE_EXTENSIONS.has(extension(name))) continue;
      const bytes = readFileSync(path);
      const projected = stripManagedCaseAnnotations(relativePath, bytes.toString('utf8'));
      if (Result.isFailure(projected)) throw new Error(`${projected.failure._tag}: ${projected.failure.path}: ${projected.failure.message}`);
      files.push({ path: relativePath, bytes: bytes.byteLength, rawSha256: sha256Hex(bytes), codeSha256: sha256Hex(projected.success) });
    }
  };
  walk(absoluteSuite);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const digest = sha256Digest(canonicalJson({
    algorithm: SOURCE_PROJECTION_ALGORITHM,
    files: files.map(({ path, codeSha256 }) => ({ path, codeSha256 })),
  }));
  return { algorithm: SOURCE_PROJECTION_ALGORITHM, digest, files };
}

export function projectRepositorySources(repositoryRoot: string, suiteRoot: string): SourceProjectionV3 {
  const root = resolve(repositoryRoot);
  const suite = governanceSuiteForFile(root, suiteRoot);
  if (suite.root !== suiteRoot) throw new Error(`SourceProjectionSuiteMismatch: ${suiteRoot} is not an exact configured suite root`);
  return projectExecutionSources(resolve(root, suite.root), suite.root);
}

export interface BuildRepositorySourceIdentityInput {
  readonly repositoryRoot: string;
  readonly caseId: string;
  readonly nativeTestFile: string;
  readonly contractRef?: string;
}

export function buildRepositorySourceIdentity(input: BuildRepositorySourceIdentityInput): RepositorySourceIdentityV4 {
  const root = resolve(input.repositoryRoot);
  const snapshot = configuration(root);
  const suite = governanceSuiteForFile(root, input.nativeTestFile);
  const declarationCandidates: { readonly path: string; readonly contract: string }[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (SOURCE_EXCLUDED_BASENAMES.has(name)) continue;
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      const pathInRepository = repositoryPath(root, path);
      if (stat.isSymbolicLink()) throw new Error(`SourceProjectionUnsupported: source identity rejects symlink ${pathInRepository}`);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || !SOURCE_EXTENSIONS.has(extension(name))) continue;
      const decoded = decodeAnnotatedCases(pathInRepository, readFileSync(path, 'utf8'));
      if (Result.isFailure(decoded)) throw new Error(`${decoded.failure._tag}: ${decoded.failure.path}: ${decoded.failure.message}`);
      declarationCandidates.push(...decoded.success
        .filter(entry => entry.caseId === input.caseId && entry.testFile === input.nativeTestFile)
        .map(entry => ({ path: entry.declarationPath, contract: entry.contract })));
    }
  };
  walk(resolve(root, suite.root));
  if (declarationCandidates.length !== 1) {
    throw new Error(`SourceIdentityCaseMismatch: expected one declaration for ${input.nativeTestFile}#${input.caseId}, found ${declarationCandidates.length}`);
  }
  const declaration = declarationCandidates[0]!;
  const declarationSuite = governanceSuiteForFile(root, declaration.path);
  if (declarationSuite.id !== suite.id) throw new Error('SourceIdentityCaseMismatch: declaration helper and native test must belong to one suite');
  if (input.contractRef !== undefined && declaration.contract !== input.contractRef) {
    throw new Error(`SourceIdentityContractMismatch: declaration targets ${declaration.contract}, expected ${input.contractRef}`);
  }
  const contractPath = declaration.contract.split('#', 1)[0]!;
  const adapterSourceDigest = snapshot.config.host === undefined
    ? null
    : sha256Digest(readFileSync(resolve(root, snapshot.config.host)));
  return {
    format: SOURCE_IDENTITY_FORMAT,
    projection: projectRepositorySources(root, suite.root),
    caseId: input.caseId,
    nativeTestFile: input.nativeTestFile,
    declarationFile: declaration.path,
    binding: {
      kind: 'direct-contract',
      suiteId: suite.id,
      contractRef: declaration.contract,
      contractSha256: sha256Hex(readFileSync(resolve(root, contractPath))),
      policy: snapshot.config.policy,
      configurationDigest: snapshot.digest,
      adapterSourceDigest,
    },
  };
}

export function sameRepositorySourceIdentity(left: RepositorySourceIdentityV4, right: RepositorySourceIdentityV4): boolean {
  return left.format === right.format
    && left.projection.algorithm === right.projection.algorithm
    && left.projection.digest === right.projection.digest
    && left.caseId === right.caseId
    && left.nativeTestFile === right.nativeTestFile
    && left.declarationFile === right.declarationFile
    && canonicalJson(left.binding) === canonicalJson(right.binding);
}

export function resolveRepositorySourceIdentity(repositoryRoot: string, selector: string): RepositorySourceIdentityV4 {
  const separator = selector.lastIndexOf('#');
  if (separator < 1) throw new Error(`SourceIdentitySelectorInvalid: ${selector}`);
  const nativeTestFile = selector.slice(0, separator);
  const caseId = selector.slice(separator + 1);
  return buildRepositorySourceIdentity({ repositoryRoot, caseId, nativeTestFile });
}
