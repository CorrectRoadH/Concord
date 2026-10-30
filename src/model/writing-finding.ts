
export interface WritingFinding {
  file: string; line: number; column?: number; rule: string; message: string; context: string;
  source?: { path: string; pointer?: string; line?: number; entry?: number; column?: string; ref?: string };
  sources?: readonly NonNullable<WritingFinding['source']>[];
  actual?: number; limit?: number; language?: 'zh' | 'en'; languagePolicy?: unknown;
  matches?: readonly { text: string; start: { line: number; column: number }; end: { line: number; column: number } }[];
}

export interface WritingReport { readonly operation: 'docs-check'; readonly ok: boolean; readonly complete: true; readonly policy: string; readonly mode: 'project' | 'managed' | 'standalone'; readonly selectedRoots: readonly string[]; readonly files: number; readonly findings: readonly WritingFinding[]; readonly inputDigest: string; }
