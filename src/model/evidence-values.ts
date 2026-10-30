import type { AdapterReport, ProcessStatus, AdapterVersions } from "./test-adapter-protocol.js";
export interface CommandEvidence {
  readonly operation: 'test-run'; readonly scope: 'command'; readonly selectedCaseId: string;
  readonly commandOutcome: 'pass' | 'fail' | 'invalid'; readonly execution: 'nonzero' | 'zero' | 'skipped' | 'unknown';
  readonly exitCode: number | null; readonly signal: string | null; readonly timedOut: boolean; readonly cancelled: boolean;
  readonly cleanupOk: boolean; readonly arguments: readonly string[];
}
export interface NativeEvidence {
  readonly operation: 'test-run'; readonly scope: 'native'; readonly selectedCaseId: string;
  readonly commandOutcome: 'green' | 'red' | 'invalid'; readonly execution: 'unknown';
  readonly exitCode: number | null; readonly signal: string | null; readonly timedOut: boolean; readonly cancelled: boolean; readonly cleanupOk: boolean;
  readonly arguments: readonly string[]; readonly adapterId: string; readonly requested: readonly string[];
  readonly observed: import("./test-adapter-protocol.js").AdapterReport['observed'];
  readonly complete: boolean; readonly gaps: readonly string[];
  readonly inputs: string; readonly definitionDigest: string; readonly planId: string; readonly planDigest: string; readonly manifestDigest: string;
  readonly statuses: readonly ProcessStatus[]; readonly assignments: readonly { readonly invocationId: string; readonly requested?: readonly string[] }[];
  readonly capabilities: AdapterReport['capabilities']; readonly versions: AdapterVersions; readonly commandExecutionCount: number;
}
export type Evidence = CommandEvidence | NativeEvidence;
