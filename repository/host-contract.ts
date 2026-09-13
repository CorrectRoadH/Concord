import type * as Inventory from './host-types/inventory-api.js';
export interface RepositoryHost {
  readonly format: 'concord.repository-host/v1';
  readonly repositoryRoot: string;
  readonly QUERY_PROTOCOL: string;
  readonly OwnedProcessLive: typeof Inventory.OwnedProcessLive;
  readonly collectRepoCaseInventory: typeof Inventory.collectRepoCaseInventory;
  readonly collectWorkspaceCaseInventory: typeof Inventory.collectWorkspaceCaseInventory;
  readonly managedInventoryImplementationDigest: typeof Inventory.managedInventoryImplementationDigest;
  readonly readManagedInventoryReceipt: typeof Inventory.readManagedInventoryReceipt;
  readonly readManagedRedEvidence: typeof Inventory.readManagedRedEvidence;
  readonly readManagedTakeoverEvidence: typeof Inventory.readManagedTakeoverEvidence;
}
