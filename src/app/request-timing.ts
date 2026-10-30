


export type Observation = 'incomplete-scan' | 'source-changed' | 'orphan-annotation' | 'cache-unavailable' | 'native-artifact-mismatch';

export interface Phase { name: string; ms: number; count: number }

export interface CacheObservation { status: string; hits?: number; misses?: number; failure?: string }

export const rounded = (value: number): number => Math.round(Math.max(0, value) * 100) / 100;


/** Labels are application-owned; no URL query, body, path argument, or error message is retained. */
export class RequestTiming {
  private readonly phases = new Map<string, Phase>();
  readonly observations = new Set<Observation>();
  readonly caches: Partial<Record<'annotations' | 'code', CacheObservation>> = {};
  constructor(readonly started: number, private readonly now: () => number = performance.now.bind(performance)) {}
  sync<A>(name: string, operation: () => A): A {
    const started = this.now();
    try { return operation(); } finally { this.record(name, this.now() - started); }
  }
  async async<A>(name: string, operation: () => Promise<A>): Promise<A> {
    const started = this.now();
    try { return await operation(); } finally { this.record(name, this.now() - started); }
  }
  record(name: string, ms: number): void {
    const key = /^[a-zA-Z.]{1,64}$/u.test(name) && (this.phases.has(name) || this.phases.size < 24) ? name : 'other';
    const phase = this.phases.get(key) ?? { name: key, ms: 0, count: 0 };
    phase.ms += ms; phase.count++;
    this.phases.set(key, phase);
  }
  result(): readonly Phase[] { return [...this.phases.values()].map(phase => ({ ...phase, ms: rounded(phase.ms) })).sort((a, b) => b.ms - a.ms); }
  workspace(value: { complete?: boolean; findings: readonly { code: string }[]; cache: unknown }): void {
    if (value.complete === false) this.observations.add('incomplete-scan');
    if (value.findings.some(item => item.code === 'SourceChanged' || item.code === 'CodeSourceChanged')) this.observations.add('source-changed');
    if (value.findings.some(item => item.code === 'OrphanCodeAnnotation')) this.observations.add('orphan-annotation');
    this.cache(value.cache);
  }
  cache(value: unknown, namespace: 'annotations' | 'code' = 'annotations'): void {
    if (typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'string') {
      const status = ['hit', 'miss', 'partial', 'off', 'unavailable', 'source-changed'].includes(value.status) ? value.status : 'unknown';
      const observation: CacheObservation = { status };
      for (const field of ['hits', 'misses'] as const) {
        if (field in value) {
          const count = (value as Record<string, unknown>)[field];
          if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) observation[field] = count;
        }
      }
      if ('detail' in value && typeof value.detail === 'string') {
        observation.failure = ['HawdbBusy', 'HawdbUnavailable', 'HawdbIncompatible', 'HawdbLimit', 'HawdbClosed', 'UnsafePath', 'InvalidData'].find(code => value.detail === code || (value.detail as string).startsWith(`${code}:`)) ?? 'unknown';
      }
      this.caches[namespace] = observation;
    }
    if (typeof value === 'object' && value !== null && 'status' in value && value.status === 'unavailable') {
      this.observations.add('cache-unavailable');
      if ('detail' in value && typeof value.detail === 'string' && value.detail.startsWith('native binary digest differs')) this.observations.add('native-artifact-mismatch');
    }
  }
}
