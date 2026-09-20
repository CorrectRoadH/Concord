import { Effect, Schema } from 'effect';
import { NativeCaseReceiptSchema, NativeInventorySchema, NativeReliabilityCertificateSchema } from 'concord-sdlc/evidence-policy';
import {
  collectVitestInventory,
  implementationDigest,
  readJson,
  repositoryRoot,
} from './native-runner.js';

const ManagedInventorySchema = Schema.Struct({
  inventoryId: Schema.String,
  implementationDigest: Schema.String,
  inventory: Schema.Struct({
    repos: Schema.Array(Schema.Struct({ id: Schema.String, receipts: Schema.Array(NativeInventorySchema) }))
  })
});
const TakeoverSchema = Schema.Struct({
  id: Schema.Literal('takeover-current'),
  certificate: NativeReliabilityCertificateSchema,
  receiptPaths: Schema.Array(Schema.String),
  candidatePath: Schema.String
});

const loadInventory = (root: string, inventoryId: string, selector: string) => {
  const stored = Schema.decodeUnknownSync(ManagedInventorySchema)(
    readJson(`${root}/.repo-tools/test-inventories/${inventoryId}.json`),
  );
  if (stored.inventoryId !== inventoryId || stored.implementationDigest !== implementationDigest(root)) {
    throw new Error('managed inventory identity or implementation digest changed');
  }
  const receipts = stored.inventory.repos.flatMap(repo => repo.receipts);
  const receipt = receipts.find(candidate => candidate.cases.some(item => `${item.path}#${item.caseId}` === selector));
  if (receipt === undefined) throw new Error(`managed inventory does not contain ${selector}`);
  return receipt;
};

export default {
  format: 'concord.repository-host/v2',
  caseIdentity: 'concord.case-contracts/v1',
  repositoryRoot,
  collectRepoCaseInventory: (suiteId: string, checkout: string) => Effect.try({
    try: () => collectVitestInventory(repositoryRoot, suiteId, checkout),
    catch: cause => cause instanceof Error ? cause : new Error(String(cause))
  }),
  managedInventoryImplementationDigest: (root: string) => Effect.try({
    try: () => implementationDigest(root),
    catch: cause => cause instanceof Error ? cause : new Error(String(cause))
  }),
  readManagedInventoryReceipt: (root: string, inventoryId: string, selector: string) => Effect.try({
    try: () => loadInventory(root, inventoryId, selector),
    catch: cause => cause instanceof Error ? cause : new Error(String(cause))
  }),
  readManagedRedEvidence: (root: string, id: string) => Effect.try({
    try: () => {
      if (id !== 'red-current') throw new Error(`unknown red evidence ${id}`);
      const receipt = Schema.decodeUnknownSync(NativeCaseReceiptSchema)(readJson(`${root}/.repo-tools/neutral-native/red.json`));
      return { id, receipt, candidatePath: 'src/calculator.ts' };
    },
    catch: cause => cause instanceof Error ? cause : new Error(String(cause))
  }),
  readManagedTakeoverEvidence: (root: string, id: string) => Effect.try({
    try: () => {
      if (id !== 'takeover-current') throw new Error(`unknown takeover evidence ${id}`);
      const takeover = Schema.decodeUnknownSync(TakeoverSchema)(readJson(`${root}/.repo-tools/neutral-native/takeover.json`));
      const receipts = new Map(takeover.receiptPaths.map(path => [path, Schema.decodeUnknownSync(NativeCaseReceiptSchema)(readJson(`${root}/${path}`))] as const));
      return { id, certificate: takeover.certificate, receipts, candidatePath: takeover.candidatePath };
    },
    catch: cause => cause instanceof Error ? cause : new Error(String(cause))
  })
};
