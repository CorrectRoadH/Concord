import { type FormalCaseReceipt, type FormalCaseReceiptV2, type TakeoverCertificate, type TakeoverCertificateV2 } from "./case-evidence.ts";
export interface ManagedRedEvidence {
    readonly id: string;
    readonly receipt: FormalCaseReceipt;
    readonly candidatePath: string;
}
export interface ManagedTakeoverEvidence {
    readonly id: string;
    readonly certificate: TakeoverCertificate;
    readonly receipts: ReadonlyMap<string, FormalCaseReceipt>;
    readonly candidatePath: string;
}
export declare function saveManagedRedEvidence(root: string, receipt: FormalCaseReceiptV2, candidatePath: string): string;
export declare function saveManagedTakeoverEvidence(root: string, certificate: TakeoverCertificateV2, receipts: ReadonlyMap<string, FormalCaseReceiptV2>, candidatePath: string): string;
export declare function readManagedRedEvidence(root: string, id: string): ManagedRedEvidence;
export declare function readManagedTakeoverEvidence(root: string, id: string): ManagedTakeoverEvidence;
