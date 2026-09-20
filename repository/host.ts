import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { Effect, Predicate } from 'effect';
import { repositoryConfiguration, RepositoryProfileError } from './root.js';
import { repositoryImplementationDigest } from './identity.js';
import type { RepositoryHost } from './host-contract.js';
import type { HostEffect } from './host-types/index.js';

type CapabilityName = Exclude<keyof RepositoryHost, 'format' | 'caseIdentity' | 'repositoryRoot'>;

let loadedHost: Promise<RepositoryHost> | undefined;

function profileError(code: string, message: string, cause?: unknown): RepositoryProfileError {
  return new RepositoryProfileError(code, cause instanceof Error ? `${message}: ${cause.message}` : message);
}

async function importRepositoryHost(): Promise<RepositoryHost> {
  const configuration = repositoryConfiguration();
  if (configuration.hostPath === undefined) {
    throw new RepositoryProfileError('RepositoryHostUnavailable', 'This repository has no native host adapter configured.');
  }
  let installed: string;
  try {
    installed = createRequire(join(configuration.root, 'package.json')).resolve('concord-sdlc/repository/identity');
  } catch (cause) {
    throw profileError('RepositoryEngineMissing', 'Install the worktree locked dependencies before requesting a native capability', cause);
  }
  if (repositoryImplementationDigest(dirname(installed)) !== repositoryImplementationDigest()) {
    throw new RepositoryProfileError('RepositoryEngineMismatch', 'This executable differs from the worktree locked Concord engine; use the consumer repository entry point.');
  }
  let imported: unknown;
  try { imported = await tsImport(pathToFileURL(configuration.hostPath).href, import.meta.url); }
  catch (cause) { throw profileError('RepositoryHostInvalid', 'The native host adapter could not be loaded', cause); }
  if (!Predicate.isObject(imported) || !('default' in imported) || !Predicate.isObject(imported.default)) {
    throw new RepositoryProfileError('RepositoryHostInvalid', 'The host must default-export a repository host contract.');
  }
  const candidate = imported.default;
  if (candidate.format !== 'concord.repository-host/v2') {
    throw new RepositoryProfileError('RepositoryHostInvalid', 'Expected repository host format concord.repository-host/v2.');
  }
  if (candidate.caseIdentity !== 'concord.case-contracts/v1') {
    throw new RepositoryProfileError('RepositoryHostCaseIdentityUnsupported', 'The host must declare case identity concord.case-contracts/v1.');
  }
  if (!Predicate.isString(candidate.repositoryRoot)) {
    throw new RepositoryProfileError('RepositoryHostInvalid', 'The host must declare its consumer repository root.');
  }
  let hostRoot: string;
  try { hostRoot = realpathSync(candidate.repositoryRoot); }
  catch (cause) { throw profileError('RepositoryHostMismatch', 'The host repository root is unavailable', cause); }
  if (hostRoot !== configuration.root) {
    throw new RepositoryProfileError('RepositoryHostMismatch', 'The host belongs to a different consumer root.');
  }
  return candidate as unknown as RepositoryHost;
}

function loadRepositoryHost(): Effect.Effect<RepositoryHost, RepositoryProfileError> {
  return Effect.tryPromise({
    try: () => loadedHost ??= importRepositoryHost(),
    catch: cause => cause instanceof RepositoryProfileError
      ? cause
      : profileError('RepositoryHostInvalid', 'The native host adapter failed to load', cause),
  });
}

function invokeCapability<A>(
  name: CapabilityName,
  call: (host: RepositoryHost) => HostEffect<A>,
): Effect.Effect<A, RepositoryProfileError | Error> {
  return loadRepositoryHost().pipe(Effect.flatMap(host => {
    if (!Predicate.isFunction(host[name])) {
      return Effect.fail(new RepositoryProfileError('RepositoryHostCapabilityMissing', `The native host adapter does not provide ${name}.`));
    }
    return Effect.try({
      try: () => call(host),
      catch: cause => profileError('RepositoryHostCapabilityFailed', `${name} failed before returning an Effect`, cause),
    }).pipe(Effect.flatMap(program => Effect.isEffect(program)
      ? program
      : Effect.fail(new RepositoryProfileError('RepositoryHostInvalid', `${name} must return an Effect.`))));
  }));
}

export const collectRepoCaseInventory = (suiteId: string, checkout: string) => invokeCapability(
  'collectRepoCaseInventory', host => host.collectRepoCaseInventory!(suiteId, checkout),
);
export const collectWorkspaceCaseInventory = (checkout: string) => invokeCapability(
  'collectWorkspaceCaseInventory', host => host.collectWorkspaceCaseInventory!(checkout),
);
export const managedInventoryImplementationDigest = (root: string) => invokeCapability(
  'managedInventoryImplementationDigest', host => host.managedInventoryImplementationDigest!(root),
);
export const readManagedInventoryReceipt = (root: string, inventoryId: string, selector: string) => invokeCapability(
  'readManagedInventoryReceipt', host => host.readManagedInventoryReceipt!(root, inventoryId, selector),
);
export const readManagedRedEvidence = (root: string, id: string) => invokeCapability(
  'readManagedRedEvidence', host => host.readManagedRedEvidence!(root, id),
);
export const readManagedTakeoverEvidence = (root: string, id: string) => invokeCapability(
  'readManagedTakeoverEvidence', host => host.readManagedTakeoverEvidence!(root, id),
);

export type {
  CaseInventoryReceipt,
  ManagedRedEvidence,
  ManagedTakeoverEvidence,
  WorkspaceInventoryReceipt,
} from './host-types/index.js';
