/** Pure statistics; thresholds are owned by the performance contract. */
export interface GroupStats { readonly samples: readonly number[]; readonly p50: number; readonly max: number; readonly valid: boolean }
export interface GroupVerdict {
  readonly command: string; readonly limitMs?: number; readonly limitKind?: 'p50' | 'max';
  readonly candidate: GroupStats; readonly baseline?: GroupStats; readonly regression?: number;
  readonly withinLimit?: boolean; readonly skipped?: string; readonly pass: boolean; readonly reasons: readonly string[];
}

export function median(samples: readonly number[]): number {
  if (samples.length === 0 || samples.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Expected nonempty finite nonnegative samples');
  const sorted = [...samples].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export function summarize(samples: readonly number[]): GroupStats {
  const p50 = median(samples), max = Math.max(...samples);
  return { samples: [...samples], p50, max, valid: max <= 2 * p50 };
}
export function judge(input: {
  readonly command: string; readonly candidate: GroupStats; readonly baseline?: GroupStats;
  readonly limitMs?: number; readonly limitKind?: 'p50' | 'max'; readonly reference: boolean;
}): GroupVerdict {
  const reasons: string[] = [];
  if (!input.candidate.valid) reasons.push('candidate samples invalid: max exceeds 2x p50');
  if (input.baseline && !input.baseline.valid) reasons.push('baseline samples invalid: max exceeds 2x p50');
  const rawRegression = input.baseline ? (input.baseline.p50 === 0 ? (input.candidate.p50 === 0 ? 0 : Infinity) : input.candidate.p50 / input.baseline.p50 - 1) : undefined;
  const regression = rawRegression === undefined || !Number.isFinite(rawRegression) ? undefined : Math.round(rawRegression * 100) / 100;
  if (input.baseline && input.candidate.p50 > input.baseline.p50 * 1.2) reasons.push(`p50 regressed ${Math.round(rawRegression! * 100)}% against baseline`);
  const observed = input.limitKind === 'max' ? input.candidate.max : input.candidate.p50;
  const withinLimit = input.limitMs === undefined ? undefined : observed <= input.limitMs;
  if (withinLimit === false && (input.reference || input.limitKind === 'max')) reasons.push(`${input.limitKind ?? 'p50'} ${observed}ms exceeds ${input.limitMs}ms`);
  return { command: input.command, candidate: input.candidate, ...(input.baseline ? { baseline: input.baseline } : {}),
    ...(regression === undefined ? {} : { regression }),
    ...(input.limitMs === undefined ? {} : { limitMs: input.limitMs, limitKind: input.limitKind ?? 'p50', withinLimit }),
    pass: reasons.length === 0, reasons };
}

/** Skipped commands do not participate, except on self where a missing owner invalidates the table. */
export function skippedVerdict(command: string, kind: 'self' | 'scale' | 'path', reason: string): GroupVerdict {
  return { command, candidate: { samples: [], p50: 0, max: 0, valid: false }, skipped: reason, pass: kind !== 'self', reasons: [reason] };
}
export function measurementPass(verdicts: readonly GroupVerdict[], kind: 'self' | 'scale' | 'path'): boolean {
  return verdicts.every(verdict => verdict.skipped ? kind !== 'self' : verdict.pass);
}
