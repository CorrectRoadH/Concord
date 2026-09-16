import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { Layer } from 'effect';
import { repositoryConfiguration, RepositoryProfileError } from './root.js';
import { repositoryImplementationDigest } from './identity.js';
import type { RepositoryHost } from './host-contract.js';
const configuration = repositoryConfiguration();
let installed: string;
try { installed = createRequire(join(configuration.root, 'package.json')).resolve('concord-sdlc/repository/identity'); }
catch { throw new RepositoryProfileError('RepositoryEngineMissing', 'Install the worktree locked dependencies before running concord repo.'); }
if (repositoryImplementationDigest(dirname(installed)) !== repositoryImplementationDigest()) throw new RepositoryProfileError('RepositoryEngineMismatch', 'This executable differs from the worktree locked Concord engine; use pnpm run repo.');
const module: unknown = await tsImport(pathToFileURL(configuration.hostPath).href, import.meta.url);
if (typeof module !== 'object' || module === null || !('default' in module)) throw new RepositoryProfileError('RepositoryHostInvalid', 'The host must default-export a repository host contract.');
const candidate: unknown = module.default;
if (typeof candidate !== 'object' || candidate === null) throw new RepositoryProfileError('RepositoryHostInvalid', 'Expected a repository host object.');
const host = candidate as RepositoryHost;
if (host.format !== 'concord.repository-host/v1' || typeof host.repositoryRoot !== 'string' || realpathSync(host.repositoryRoot) !== configuration.root) throw new RepositoryProfileError('RepositoryHostMismatch', 'The runner host belongs to a different consumer root.');
if (host.caseIdentity !== 'concord.case-contracts/v1') throw new RepositoryProfileError('RepositoryHostCaseIdentityUnsupported', 'The runner host must declare case identity concord.case-contracts/v1.');
for (const key of ['collectRepoCaseInventory', 'collectWorkspaceCaseInventory', 'managedInventoryImplementationDigest', 'readManagedInventoryReceipt', 'readManagedRedEvidence', 'readManagedTakeoverEvidence'] as const) if (typeof host[key] !== 'function') throw new RepositoryProfileError('RepositoryHostInvalid', `The runner host is missing ${key}.`);
if (!Layer.isLayer(host.OwnedProcessLive)) throw new RepositoryProfileError('RepositoryHostInvalid', 'The runner host must supply its owned-process Layer.');
if (typeof host.QUERY_PROTOCOL !== 'string' || !host.QUERY_PROTOCOL) throw new RepositoryProfileError('RepositoryHostInvalid', 'The host must supply its query protocol identity.');
export const OwnedProcessLive: RepositoryHost['OwnedProcessLive'] = host.OwnedProcessLive;
export const { QUERY_PROTOCOL, collectRepoCaseInventory, collectWorkspaceCaseInventory, managedInventoryImplementationDigest, readManagedInventoryReceipt, readManagedRedEvidence, readManagedTakeoverEvidence } = host;
export type { CaseInventoryReceipt, WorkspaceInventoryReceipt, OwnedProcess } from './host-types/inventory-api.js';
