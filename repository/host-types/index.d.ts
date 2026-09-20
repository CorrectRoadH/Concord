import type { Effect } from 'effect';
import type { RepositorySourceIdentityV4 } from '../source-identity.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface InventoryCase {
  readonly executor: string;
  readonly repo: string;
  readonly path: string;
  readonly project?: string;
  readonly titlePath: readonly string[];
  readonly caseId: string;
}

export interface CaseInventoryReceipt {
  readonly executor: { readonly name: string; readonly version: string };
  readonly repo: string;
  readonly argv: readonly string[];
  readonly checkout: string;
  readonly files: readonly string[];
  readonly cases: readonly InventoryCase[];
  readonly unassignedCases: readonly { readonly file: string; readonly project?: string; readonly titlePath: readonly string[] }[];
  readonly bodyExecutions: 0;
  readonly forbiddenSetupExecutions: 0;
  readonly findings: readonly string[];
  readonly digest: `sha256:${string}`;
  readonly exit: number | null;
  readonly signal: string | null;
}

export interface WorkspaceInventoryReceipt {
  readonly checkout: string;
  readonly repos: readonly { readonly id: string; readonly receipts: readonly CaseInventoryReceipt[] }[];
  readonly files: readonly string[];
  readonly cases: readonly InventoryCase[];
  readonly unassignedCases: readonly { readonly executor: string; readonly repo: string; readonly path: string; readonly project?: string; readonly titlePath: readonly string[] }[];
  readonly findings: readonly string[];
  readonly digest: `sha256:${string}`;
}

export interface NativeCaseReceipt {
  readonly format: 'concord.native-case-receipt/v1';
  readonly mode: 'formal';
  readonly observation: 'red' | 'green' | 'reliability';
  readonly selector: string;
  readonly caseId: string;
  readonly inventoryDigest: string;
  readonly problem: { readonly path: string; readonly epoch: number };
  readonly candidate: { readonly gitSha: string; readonly sha256: string; readonly sri: string };
  readonly source: RepositorySourceIdentityV4;
  readonly runner: { readonly executor: string; readonly version: string; readonly implementationDigest: string; readonly argv: readonly string[] };
  readonly result: {
    readonly disposition: 'regression' | 'pass';
    readonly stage: string;
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly timedOut: boolean;
    readonly startupFailed: boolean;
  };
  readonly native: {
    readonly copyId: string;
    readonly copyPath: string;
    readonly sequence: number;
    readonly mode: 'single' | 'isolated' | 'same' | 'parallel';
    readonly caseCount: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly retries: number;
    readonly parallelism: number;
  };
  readonly cleanup: { readonly ok: boolean; readonly resources: readonly { readonly [key: string]: JsonValue }[] };
  readonly invocationId: string;
  readonly receiptSha256: string;
}

export interface NativeReliabilityCertificate {
  readonly format: 'concord.native-reliability/v1';
  readonly selector: string;
  readonly caseId: string;
  readonly candidateSha256: string;
  readonly sourceDigest: string;
  readonly greenReceipt: string;
  readonly observations: {
    readonly isolatedCopies: readonly [string, string, string];
    readonly sameCopy: readonly [string, string];
    readonly defaultParallel: string;
    readonly singleCase: string;
    readonly cleanup: readonly string[];
  };
  readonly certificateSha256: string;
}

export interface ManagedRedEvidence {
  readonly id: string;
  readonly receipt: NativeCaseReceipt;
  readonly candidatePath: string;
}

export interface ManagedTakeoverEvidence {
  readonly id: string;
  readonly certificate: NativeReliabilityCertificate;
  readonly receipts: ReadonlyMap<string, NativeCaseReceipt>;
  readonly candidatePath: string;
}

export interface RepositoryHostFailure extends Error {
  readonly detail?: string;
}

export type HostEffect<A> = Effect.Effect<A, RepositoryHostFailure>;
