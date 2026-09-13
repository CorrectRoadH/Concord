import { type CaseInventoryReceipt, type CollectedCase } from "./inventory.ts";
export interface FormalCaseReceiptV1 {
    readonly format: "niceeval.e2e-case-receipt/v1";
    readonly mode: "formal";
    readonly observation: "red" | "green" | "reliability";
    readonly selector: string;
    readonly caseId: string;
    readonly inventoryDigest: string;
    readonly candidate: {
        readonly gitSha: string;
        readonly sha256: string;
        readonly sri: string;
    };
    readonly source: {
        readonly checkout: string;
        readonly testFileSha256: string;
        readonly sidecarSha256: string;
    };
    readonly runner: {
        readonly executor: "vitest" | "playwright";
        readonly version: string;
        readonly argv: readonly string[];
    };
    readonly result: {
        readonly disposition: "regression" | "pass";
        readonly stage: string;
        readonly exitCode: number | null;
        readonly signal: string | null;
    };
    readonly cleanup: {
        readonly ok: boolean;
        readonly resources: readonly object[];
    };
    readonly invocationId: string;
    readonly receiptSha256: string;
}
export interface TakeoverCertificateV1 {
    readonly format: "niceeval.e2e-takeover-certificate/v1";
    readonly selector: string;
    readonly caseId: string;
    readonly candidateSha256: string;
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
export declare const canonicalJson: (value: unknown) => string;
export declare const sha256Hex: (bytes: string | Uint8Array) => string;
export declare const managedInventoryImplementationDigest: (root: string) => string;
export declare const parseExactSelector: (selector: string) => {
    readonly path: string;
    readonly caseId: string;
};
export declare const exactCaseNativeArgs: (executor: "vitest" | "playwright", path: string, caseId: string) => readonly string[];
export declare const validateInventoryReceipt: (input: unknown) => CaseInventoryReceipt;
export declare const readManagedInventoryReceipt: (root: string, inventoryId: string, selector: string) => CaseInventoryReceipt;
export declare const selectInventoryCase: (receipt: CaseInventoryReceipt, selector: string, repo: string) => CollectedCase;
export declare const signFormalCaseReceipt: (unsigned: Omit<FormalCaseReceiptV1, "receiptSha256">) => FormalCaseReceiptV1;
export declare const validateFormalCaseReceipt: (input: unknown) => FormalCaseReceiptV1;
export declare const signTakeoverCertificate: (unsigned: Omit<TakeoverCertificateV1, "certificateSha256">) => TakeoverCertificateV1;
export declare const validateTakeoverCertificate: (input: unknown, receipts: ReadonlyMap<string, FormalCaseReceiptV1>) => TakeoverCertificateV1;
