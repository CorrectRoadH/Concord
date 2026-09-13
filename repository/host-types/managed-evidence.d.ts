import { type FormalCaseReceiptV1, type TakeoverCertificateV1 } from "./case-evidence.ts";
export interface ManagedRedEvidence {
    readonly id: string;
    readonly receipt: FormalCaseReceiptV1;
    readonly candidatePath: string;
}
export interface ManagedTakeoverEvidence {
    readonly id: string;
    readonly certificate: TakeoverCertificateV1;
    readonly receipts: ReadonlyMap<string, FormalCaseReceiptV1>;
    readonly candidatePath: string;
}
export declare function saveManagedRedEvidence(root: string, receipt: FormalCaseReceiptV1, candidatePath: string): string;
export declare function saveManagedTakeoverEvidence(root: string, certificate: TakeoverCertificateV1, receipts: ReadonlyMap<string, FormalCaseReceiptV1>, candidatePath: string): string;
export declare function readManagedRedEvidence(root: string, id: string): ManagedRedEvidence;
export declare function readManagedTakeoverEvidence(root: string, id: string): ManagedTakeoverEvidence;
