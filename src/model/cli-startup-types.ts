export interface StartupReceipt {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

// Generated executable data is validated by the build, then checked against
// the entry, manifest and command files before use by the light entry.
export interface StartupData {
  readonly format: 'concord.startup/v1';
  readonly packageDigest: string;
  readonly files: Readonly<Record<string, string>>;
  readonly sourceFiles: Readonly<Record<string, string>>;
  readonly receipts: Readonly<Record<string, StartupReceipt>>;
  readonly groups: readonly { readonly name: string; readonly description?: string }[];
}
