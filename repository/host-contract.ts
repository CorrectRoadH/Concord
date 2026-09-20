import type {
  CaseInventoryReceipt,
  HostEffect,
  ManagedRedEvidence,
  ManagedTakeoverEvidence,
  WorkspaceInventoryReceipt,
} from './host-types/index.js';

export interface RepositoryHost {
  readonly format: 'concord.repository-host/v2';
  readonly caseIdentity: 'concord.case-contracts/v1';
  readonly repositoryRoot: string;
  readonly collectRepoCaseInventory?: (suiteId: string, checkout: string) => HostEffect<WorkspaceInventoryReceipt>;
  readonly collectWorkspaceCaseInventory?: (checkout: string) => HostEffect<WorkspaceInventoryReceipt>;
  readonly managedInventoryImplementationDigest?: (root: string) => HostEffect<string>;
  readonly readManagedInventoryReceipt?: (root: string, inventoryId: string, selector: string) => HostEffect<CaseInventoryReceipt>;
  readonly readManagedRedEvidence?: (root: string, id: string) => HostEffect<ManagedRedEvidence>;
  readonly readManagedTakeoverEvidence?: (root: string, id: string) => HostEffect<ManagedTakeoverEvidence>;
}
