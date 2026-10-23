// Real native fixture transport; it reuses the neutral Vitest executor and does
// not manufacture observations. Library-free consumers are tested separately.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import * as Effect from 'effect/Effect';

type Request = { format: string; requestId: string; root: string; op: string; engine: { implementationDigest: string }; payload: { suiteId: string; inventoryId: string; selector: string; id: string; checkout: string } };
const request = JSON.parse(readFileSync(0, 'utf8')) as Request;
const { default: host } = await import(new URL('./acceptance/host.ts', import.meta.url).href) as { default: typeof import('./neutral-native/acceptance/host.js').default };
const root = process.cwd();
mkdirSync(join(root, '.repo-tools'), { recursive: true });
appendFileSync(join(root, '.repo-tools/adapter-invocations'), `${request.op}\n`);
const guards: { path: string; digest: string }[] = [];
const guard = (path: string) => { guards.push({ path, digest: 'sha256:' + createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }); };
let result: unknown;
switch (request.op) {
  case 'collect-repo': result = await Effect.runPromise(host.collectRepoCaseInventory(request.payload.suiteId, request.payload.checkout)); break;
  case 'read-inventory':
    result = await Effect.runPromise(host.readManagedInventoryReceipt(root, request.payload.inventoryId, request.payload.selector));
    guard(`.repo-tools/test-inventories/${request.payload.inventoryId}.json`);
    break;
  case 'read-red': {
    const evidence = await Effect.runPromise(host.readManagedRedEvidence(root, request.payload.id));
    const candidatePath = '.repo-tools/neutral-native/red-candidate.ts';
    writeFileSync(join(root, candidatePath), execFileSync('git', ['show', `${evidence.receipt.candidate.gitSha}:src/calculator.ts`]));
    guard('.repo-tools/neutral-native/red.json'); guard(candidatePath);
    result = { ...evidence, candidatePath };
    break;
  }
  case 'read-takeover': {
    const evidence = await Effect.runPromise(host.readManagedTakeoverEvidence(root, request.payload.id));
    guard('.repo-tools/neutral-native/takeover.json'); guard(evidence.candidatePath);
    for (const key of evidence.receipts.keys()) guard(key);
    result = { ...evidence, receipts: [...evidence.receipts].map(([key, receipt]) => ({ key, receipt })) };
    break;
  }
  default: throw new Error('Unsupported fixture operation');
}
process.stdout.write(JSON.stringify({ format: request.format, requestId: request.requestId, root, op: request.op, engineDigest: request.engine.implementationDigest, result, guards }) + '\n');
