export interface StartupReceipt {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}
