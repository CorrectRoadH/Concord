// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Schema } from 'effect';

export const GOVERNANCE_CONFIGURATION_PATH = 'concord.repository.json' as const;
export const NATIVE_RELIABILITY_POLICY = 'concord.native-reliability/v1' as const;

const CanonicalPath = Schema.String.check(Schema.makeFilter(
  path => path.length > 0 && path.trim() === path && !isAbsolute(path) && !/[\\\0\r\n#]/u.test(path)
    && path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..'),
  { identifier: 'CanonicalRepositoryPath' },
));
const SuiteId = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/u));
const GovernanceSuiteSchema = Schema.Struct({ id: SuiteId, root: CanonicalPath });
export const GovernanceConfigurationSchema = Schema.Struct({
  format: Schema.Literal('concord.repository/v2'),
  suites: Schema.NonEmptyArray(GovernanceSuiteSchema),
  historyPath: CanonicalPath,
  policy: Schema.Literal(NATIVE_RELIABILITY_POLICY),
  host: Schema.optional(CanonicalPath),
});

export type GovernanceSuite = typeof GovernanceSuiteSchema.Type;
export type GovernanceConfiguration = typeof GovernanceConfigurationSchema.Type;
export interface GovernanceConfigurationSnapshot {
  readonly path: typeof GOVERNANCE_CONFIGURATION_PATH;
  readonly source: string;
  readonly digest: string;
  readonly config: GovernanceConfiguration;
}

export class GovernanceConfigurationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}

const sha256 = (value: string | Uint8Array): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const slash = (path: string): string => path.split(sep).join('/');
const contains = (parent: string, child: string): boolean => child === parent || child.startsWith(`${parent}/`);
const missing = (cause: unknown): boolean => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';

function checkedRoot(root: string): string {
  const absolute = resolve(root);
  let status;
  try { status = lstatSync(absolute); }
  catch { throw new GovernanceConfigurationError('GovernanceRootInvalid', `Repository root does not exist: ${absolute}`); }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new GovernanceConfigurationError('GovernanceRootInvalid', 'Repository root must be a regular directory, not a symbolic link.');
  }
  return absolute;
}

function assertNoSymlink(root: string, path: string, subject: string): string {
  let current = root;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    let status;
    try { status = lstatSync(current); }
    catch (cause) {
      if (missing(cause)) break;
      throw new GovernanceConfigurationError('GovernancePathInvalid', `${subject} cannot be inspected: ${path}`);
    }
    if (status.isSymbolicLink()) {
      throw new GovernanceConfigurationError('GovernancePathSymlink', `${subject} cannot contain a symbolic-link component: ${path}`);
    }
  }
  return resolve(root, path);
}

function assertConfigurationPaths(root: string, config: GovernanceConfiguration): void {
  const ids = new Set<string>();
  const roots = new Set<string>();
  for (const suite of config.suites) {
    if (ids.has(suite.id)) throw new GovernanceConfigurationError('GovernanceSuiteDuplicate', `Duplicate suite id: ${suite.id}`);
    if (roots.has(suite.root)) throw new GovernanceConfigurationError('GovernanceSuiteDuplicate', `Duplicate suite root: ${suite.root}`);
    ids.add(suite.id);
    roots.add(suite.root);
    const path = assertNoSymlink(root, suite.root, `Suite ${suite.id}`);
    let status;
    try { status = lstatSync(path); }
    catch { throw new GovernanceConfigurationError('GovernanceSuiteMissing', `Suite root does not exist: ${suite.root}`); }
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new GovernanceConfigurationError('GovernanceSuiteInvalid', `Suite root must be a regular directory: ${suite.root}`);
    }
  }
  for (let leftIndex = 0; leftIndex < config.suites.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < config.suites.length; rightIndex += 1) {
      const left = config.suites[leftIndex]!;
      const right = config.suites[rightIndex]!;
      if (contains(left.root, right.root) || contains(right.root, left.root)) {
        throw new GovernanceConfigurationError('GovernanceSuiteOverlap', `Suite roots overlap: ${left.root} and ${right.root}`);
      }
    }
  }
  const history = assertNoSymlink(root, config.historyPath, 'History path');
  const containingSuite = config.suites.find(suite => contains(suite.root, config.historyPath));
  if (containingSuite !== undefined) {
    throw new GovernanceConfigurationError('GovernanceHistoryOverlap', `History path must be outside suite ${containingSuite.id}: ${config.historyPath}`);
  }
  try {
    const status = lstatSync(history);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new GovernanceConfigurationError('GovernanceHistoryInvalid', `Existing history path must be a regular file: ${config.historyPath}`);
    }
  } catch (cause) {
    if (!missing(cause)) throw cause;
  }
  if (config.host !== undefined) {
    const host = assertNoSymlink(root, config.host, 'Host path');
    let status;
    try { status = lstatSync(host); }
    catch { throw new GovernanceConfigurationError('GovernanceHostMissing', `Host file does not exist: ${config.host}`); }
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new GovernanceConfigurationError('GovernanceHostInvalid', `Host must be a regular file: ${config.host}`);
    }
  }
}

export function readGovernanceConfiguration(root: string): GovernanceConfigurationSnapshot | undefined {
  const repositoryRoot = checkedRoot(root);
  const absolute = resolve(repositoryRoot, GOVERNANCE_CONFIGURATION_PATH);
  let status;
  try { status = lstatSync(absolute); }
  catch (cause) {
    if (missing(cause)) return undefined;
    throw new GovernanceConfigurationError('GovernanceConfigurationUnsafe', `${GOVERNANCE_CONFIGURATION_PATH} cannot be inspected.`);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new GovernanceConfigurationError('GovernanceConfigurationUnsafe', `${GOVERNANCE_CONFIGURATION_PATH} must be a regular file.`);
  }
  const source = readFileSync(absolute, 'utf8');
  let input: unknown;
  try { input = JSON.parse(source) as unknown; }
  catch (cause) {
    throw new GovernanceConfigurationError('GovernanceConfigurationInvalid', `${GOVERNANCE_CONFIGURATION_PATH}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (typeof input === 'object' && input !== null && 'format' in input && input.format === 'concord.repository/v1') {
    throw new GovernanceConfigurationError('GovernanceConfigurationMigrationRequired', 'concord.repository/v1 is read-only legacy state; migrate it offline to concord.repository/v2.');
  }
  let config: GovernanceConfiguration;
  try {
    config = Schema.decodeUnknownSync(GovernanceConfigurationSchema, { errors: 'all', onExcessProperty: 'error' })(input);
  } catch (cause) {
    throw new GovernanceConfigurationError('GovernanceConfigurationInvalid', `${GOVERNANCE_CONFIGURATION_PATH}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  assertConfigurationPaths(repositoryRoot, config);
  return { path: GOVERNANCE_CONFIGURATION_PATH, source, digest: sha256(source), config };
}

export function governanceSuiteForFile(root: string, file: string): GovernanceSuite {
  const repositoryRoot = checkedRoot(root);
  const snapshot = readGovernanceConfiguration(repositoryRoot);
  if (snapshot === undefined) {
    throw new GovernanceConfigurationError('GovernanceConfigurationMissing', `Repository has no ${GOVERNANCE_CONFIGURATION_PATH}.`);
  }
  const repositoryPath = isAbsolute(file) ? slash(relative(repositoryRoot, resolve(file))) : file;
  if (repositoryPath.length === 0 || repositoryPath.trim() !== repositoryPath || isAbsolute(repositoryPath)
    || /[\\\0\r\n#]/u.test(repositoryPath)
    || repositoryPath.split('/').some(part => part.length === 0 || part === '.' || part === '..')) {
    throw new GovernanceConfigurationError('GovernanceFilePathInvalid', `Expected one canonical repository-relative path: ${file}`);
  }
  const absolute = resolve(repositoryRoot, repositoryPath);
  if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}${sep}`)) {
    throw new GovernanceConfigurationError('GovernanceFilePathInvalid', `Path escapes the repository: ${file}`);
  }
  assertNoSymlink(repositoryRoot, repositoryPath, 'Governed file');
  const matches = snapshot.config.suites.filter(suite => contains(suite.root, repositoryPath));
  if (matches.length === 0) {
    throw new GovernanceConfigurationError('GovernanceSuiteNotFound', `${repositoryPath} does not belong to a configured suite.`);
  }
  if (matches.length !== 1) {
    throw new GovernanceConfigurationError('GovernanceSuiteAmbiguous', `${repositoryPath} belongs to more than one configured suite.`);
  }
  return matches[0]!;
}
