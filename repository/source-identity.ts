import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { Result, Schema } from "effect";

import { decodeAnnotatedCases, stripManagedCaseAnnotations } from "./docs/test-case/annotations.js";
import { testingOwnerContracts } from "./docs/trace/compiler.js";

export const SOURCE_PROJECTION_ALGORITHM = "concord.repository-source-projection/v1" as const;
export const SOURCE_IDENTITY_FORMAT = "concord.repository-source-identity/v2" as const;
export const SOURCE_EXTENSIONS = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);
export const SOURCE_EXCLUDED_BASENAMES = new Set(["node_modules", ".git", ".niceeval", ".env", ".e2e-artifacts", ".e2e-diagnostics", "case-evidence", "test-inventories"]);

export interface SourceProjectionFile {
  readonly path: string;
  readonly bytes: number;
  readonly rawSha256: string;
  readonly codeSha256: string;
}
export interface SourceProjectionV1 {
  readonly algorithm: typeof SOURCE_PROJECTION_ALGORITHM;
  readonly digest: string;
  readonly files: readonly SourceProjectionFile[];
}
export interface RepositorySourceIdentityV2 {
  readonly format: typeof SOURCE_IDENTITY_FORMAT;
  readonly projection: SourceProjectionV1;
  readonly caseId: string;
  readonly nativeTestFile: string;
  readonly declarationFile: string;
  readonly ownerRef: string;
  readonly contractRef: string;
  readonly ownerSha256: string;
  readonly contractSha256: string;
}

const Sha256Schema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const ProjectionPathSchema = Schema.String.check(Schema.makeFilter((path) => path.length > 0
  && !path.startsWith("/")
  && !path.includes("\\")
  && path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."), { identifier: "CanonicalProjectionPath" }));
export const SourceProjectionFileSchema = Schema.Struct({
  path: ProjectionPathSchema,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rawSha256: Sha256Schema,
  codeSha256: Sha256Schema,
});
export const SourceProjectionV1Schema = Schema.Struct({
  algorithm: Schema.Literal(SOURCE_PROJECTION_ALGORITHM),
  digest: Sha256Schema,
  files: Schema.Array(SourceProjectionFileSchema),
});
export const RepositorySourceIdentityV2Schema = Schema.Struct({
  format: Schema.Literal(SOURCE_IDENTITY_FORMAT),
  projection: SourceProjectionV1Schema,
  caseId: Schema.String.check(Schema.isPattern(/^necase_[0-9A-HJKMNP-TV-Z]{16}$/u)),
  nativeTestFile: ProjectionPathSchema,
  declarationFile: ProjectionPathSchema,
  ownerRef: Schema.String,
  contractRef: Schema.String,
  ownerSha256: Sha256Schema,
  contractSha256: Sha256Schema,
});

const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const relativePath = (root: string, path: string): string => relative(root, path).split(sep).join("/");
const extension = (path: string): string => path.slice(path.lastIndexOf(".") + 1).toLowerCase();

export function decodeSourceProjectionV1(input: unknown): SourceProjectionV1 {
  let projection: SourceProjectionV1;
  try { projection = Schema.decodeUnknownSync(SourceProjectionV1Schema, { errors: "all", onExcessProperty: "error" })(input); }
  catch (cause) { throw new Error(`SourceIdentityInvalid: ${cause instanceof Error ? cause.message : String(cause)}`); }
  const paths = projection.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => index > 0 && paths[index - 1]!.localeCompare(path) >= 0)) throw new Error("SourceIdentityInvalid: projection paths must be unique and strictly sorted");
  const digest = sha256(canonicalJson({ algorithm: SOURCE_PROJECTION_ALGORITHM, files: projection.files.map(({ path, codeSha256 }) => ({ path, codeSha256 })) }));
  if (projection.digest !== digest) throw new Error(`SourceIdentityInvalid: projection digest mismatch; expected ${digest}`);
  return projection;
}

export function decodeRepositorySourceIdentityV2(input: unknown): RepositorySourceIdentityV2 {
  let identity: RepositorySourceIdentityV2;
  try { identity = Schema.decodeUnknownSync(RepositorySourceIdentityV2Schema, { errors: "all", onExcessProperty: "error" })(input); }
  catch (cause) { throw new Error(`SourceIdentityInvalid: ${cause instanceof Error ? cause.message : String(cause)}`); }
  const projection = decodeSourceProjectionV1(identity.projection);
  const projected = (repositoryPath: string): boolean => projection.files.filter((file) => repositoryPath === file.path || repositoryPath.endsWith(`/${file.path}`)).length === 1;
  if (!projected(identity.nativeTestFile) || !projected(identity.declarationFile)) throw new Error("SourceIdentityInvalid: native test and declaration files must each belong to the signed project projection");
  const reference = (value: string, anchor: boolean): boolean => value.trim() === value && !value.startsWith("/") && !value.includes("\\") && value.split("#", 1)[0]!.split("/").every((part) => part.length > 0 && part !== "." && part !== "..") && (!anchor || value.lastIndexOf("#") > 0 && value.lastIndexOf("#") < value.length - 1);
  if (!reference(identity.ownerRef, true) || !reference(identity.contractRef, false)) throw new Error("SourceIdentityInvalid: ownerRef or contractRef is not canonical");
  return { ...identity, projection };
}

export function projectRepositorySources(projectRoot: string): SourceProjectionV1 {
  const root = resolve(projectRoot);
  const files: SourceProjectionFile[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (SOURCE_EXCLUDED_BASENAMES.has(name)) continue;
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`SourceProjectionUnsupported: source projection rejects symlink ${relativePath(root, path)}`);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile()) throw new Error(`SourceProjectionUnsupported: source projection rejects special file ${relativePath(root, path)}`);
      if (!SOURCE_EXTENSIONS.has(extension(name))) continue;
      const bytes = readFileSync(path);
      const source = bytes.toString("utf8");
      const projected = stripManagedCaseAnnotations(relativePath(root, path), source);
      if (Result.isFailure(projected)) throw new Error(`${projected.failure._tag}: ${projected.failure.path}: ${projected.failure.message}`);
      files.push({ path: relativePath(root, path), bytes: bytes.byteLength, rawSha256: sha256(bytes), codeSha256: sha256(projected.success) });
    }
  };
  walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const digest = sha256(canonicalJson({ algorithm: SOURCE_PROJECTION_ALGORITHM, files: files.map(({ path, codeSha256 }) => ({ path, codeSha256 })) }));
  return { algorithm: SOURCE_PROJECTION_ALGORITHM, digest, files };
}

export interface BuildRepositorySourceIdentityInput {
  readonly repositoryRoot: string;
  readonly projectRoot: string;
  readonly caseId: string;
  readonly nativeTestFile: string;
  readonly ownerRef: string;
  readonly contractRef: string;
}

export function buildRepositorySourceIdentity(input: BuildRepositorySourceIdentityInput): RepositorySourceIdentityV2 {
  const declarationCandidates: { readonly path: string; readonly owner: string }[] = [];
  let projectPrefix = dirname(input.nativeTestFile);
  while (projectPrefix.startsWith("e2e/") && !existsSync(resolve(input.repositoryRoot, projectPrefix, "project.json"))) projectPrefix = dirname(projectPrefix);
  if (!projectPrefix.startsWith("e2e/") || !existsSync(resolve(input.repositoryRoot, projectPrefix, "project.json"))) throw new Error(`SourceIdentityCaseMismatch: cannot locate project root for ${input.nativeTestFile}`);
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (SOURCE_EXCLUDED_BASENAMES.has(name)) continue;
      const path = resolve(directory, name); const stat = lstatSync(path);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || !SOURCE_EXTENSIONS.has(extension(name))) continue;
      const repoPath = `${projectPrefix}/${relativePath(resolve(input.projectRoot), path)}`;
      const decoded = decodeAnnotatedCases(repoPath, readFileSync(path, "utf8"));
      if (Result.isFailure(decoded)) throw new Error(`${decoded.failure._tag}: ${decoded.failure.path}: ${decoded.failure.message}`);
      declarationCandidates.push(...decoded.success.filter((entry) => entry.caseId === input.caseId && entry.testFile === input.nativeTestFile).map((entry) => ({ path: entry.declarationPath, owner: entry.owner })));
    }
  };
  walk(resolve(input.projectRoot));
  if (declarationCandidates.length !== 1) throw new Error(`SourceIdentityCaseMismatch: expected one declaration for ${input.nativeTestFile}#${input.caseId}, found ${declarationCandidates.length}`);
  const declaration = declarationCandidates[0]!;
  if (declaration.owner !== input.ownerRef) throw new Error(`SourceIdentityOwnerMismatch: declaration owns ${declaration.owner}, expected ${input.ownerRef}`);
  const ownerPath = input.ownerRef.slice(0, input.ownerRef.lastIndexOf("#"));
  const contractPath = input.contractRef.split("#", 1)[0]!;
  return {
    format: SOURCE_IDENTITY_FORMAT,
    projection: projectRepositorySources(input.projectRoot),
    caseId: input.caseId,
    nativeTestFile: input.nativeTestFile,
    declarationFile: declaration.path,
    ownerRef: input.ownerRef,
    contractRef: input.contractRef,
    ownerSha256: sha256(readFileSync(resolve(input.repositoryRoot, ownerPath))),
    contractSha256: sha256(readFileSync(resolve(input.repositoryRoot, contractPath))),
  };
}

export function sameRepositorySourceIdentity(left: RepositorySourceIdentityV2, right: RepositorySourceIdentityV2): boolean {
  return left.format === right.format && left.projection.algorithm === right.projection.algorithm && left.projection.digest === right.projection.digest && left.caseId === right.caseId && left.nativeTestFile === right.nativeTestFile && left.declarationFile === right.declarationFile && left.ownerRef === right.ownerRef && left.contractRef === right.contractRef && left.ownerSha256 === right.ownerSha256 && left.contractSha256 === right.contractSha256;
}

export function resolveRepositorySourceIdentity(repositoryRoot: string, projectRoot: string, selector: string): RepositorySourceIdentityV2 {
  const separator = selector.lastIndexOf("#");
  if (separator < 1) throw new Error(`SourceIdentitySelectorInvalid: ${selector}`);
  const nativeTestFile = selector.slice(0, separator); const caseId = selector.slice(separator + 1);
  const matches: AnnotatedCaseIdentity[] = [];
  let projectPrefix = dirname(nativeTestFile);
  while (projectPrefix.startsWith("e2e/") && !existsSync(resolve(repositoryRoot, projectPrefix, "project.json"))) projectPrefix = dirname(projectPrefix);
  if (!projectPrefix.startsWith("e2e/") || !existsSync(resolve(repositoryRoot, projectPrefix, "project.json"))) throw new Error(`SourceIdentityCaseMismatch: cannot locate project root for ${nativeTestFile}`);
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (SOURCE_EXCLUDED_BASENAMES.has(name)) continue;
      const path = resolve(directory, name); const stat = lstatSync(path);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || !SOURCE_EXTENSIONS.has(extension(name))) continue;
      const repoPath = `${projectPrefix}/${relativePath(resolve(projectRoot), path)}`;
      const decoded = decodeAnnotatedCases(repoPath, readFileSync(path, "utf8"));
      if (Result.isFailure(decoded)) throw new Error(`${decoded.failure._tag}: ${decoded.failure.path}: ${decoded.failure.message}`);
      matches.push(...decoded.success.filter((entry) => entry.caseId === caseId && entry.testFile === nativeTestFile).map((entry) => ({ ownerRef: entry.owner })));
    }
  };
  walk(resolve(projectRoot));
  if (matches.length !== 1) throw new Error(`SourceIdentityCaseMismatch: expected one current declaration for ${selector}, found ${matches.length}`);
  const ownerRef = matches[0]!.ownerRef;
  const ownerPath = ownerRef.slice(0, ownerRef.lastIndexOf("#"));
  const ownerSource = readFileSync(resolve(repositoryRoot, ownerPath), "utf8");
  const owner = testingOwnerContracts([[ownerPath, ownerSource]]).find((entry) => entry.ref === ownerRef);
  if (owner === undefined) throw new Error(`SourceIdentityOwnerMismatch: ${ownerRef} is not an exact testing owner`);
  return buildRepositorySourceIdentity({ repositoryRoot, projectRoot, caseId, nativeTestFile, ownerRef, contractRef: owner.contract });
}

interface AnnotatedCaseIdentity { readonly ownerRef: string }
