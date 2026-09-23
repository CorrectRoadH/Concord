// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from 'effect';
import { createMemoryHawdb, type HawdbDatabase, type HawdbEntry, type HawdbNamespace } from './hawdb-native.js';
import { canonical, decode, digest, objectDigest } from './shared.js';

const EnvelopeSchema = Schema.Struct({ parser: Schema.String, sourceDigest: Schema.String, present: Schema.Boolean, value: Schema.optional(Schema.Unknown) });
const BATCH = 1000;

/** Owns only a bounded HawDB handle; caller source bytes and parser version own identity. */
export class ContentCache<A> {
  private database: HawdbDatabase | undefined;

  constructor(private readonly namespace: Extract<HawdbNamespace, 'document_parse' | 'code_parse'>, private readonly parser: string, private readonly valueSchema: Schema.ConstraintDecoder<A, never>) {}

  private engine(): HawdbDatabase | undefined {
    try { return this.database ?? (this.database = createMemoryHawdb()); }
    catch { return undefined; }
  }

  close(): void { this.database?.close(); this.database = undefined; }

  get(path: string, source: string, parse: () => A): A {
    return this.getMany([{ path, source }], () => parse())[0]!;
  }

  getMany(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }) => A): A[] {
    if (inputs.length === 0) return [];
    const database = this.engine();
    const identities = inputs.map(input => {
      const sourceDigest = digest(input.source);
      return { input, sourceDigest, key: objectDigest({ parser: this.parser, path: input.path, sourceDigest }) };
    });
    const found = new Map<string, string>();
    if (database !== undefined) try {
      for (let index = 0; index < identities.length; index += BATCH) {
        for (const entry of database.get(this.namespace, identities.slice(index, index + BATCH).map(item => item.key))) found.set(entry.key, entry.payload);
      }
    } catch { found.clear(); }
    const writes: HawdbEntry[] = [];
    const values = identities.map(({ input, key, sourceDigest }) => {
      const payload = found.get(key);
      if (payload !== undefined) try {
        const envelope = decode(EnvelopeSchema, JSON.parse(payload), 'content cache');
        if (envelope.parser === this.parser && envelope.sourceDigest === sourceDigest && (envelope.present || envelope.value === undefined)) {
          return envelope.present ? decode(this.valueSchema, envelope.value, 'content cache value') : undefined as A;
        }
      } catch { /* damaged cache is a miss */ }
      const value = parse(input);
      try { writes.push({ key, payload: canonical({ parser: this.parser, sourceDigest, present: value !== undefined, ...(value === undefined ? {} : { value }) }) }); }
      catch { /* uncacheable parse output is still returned */ }
      return value;
    });
    if (database !== undefined) try {
      for (let index = 0; index < writes.length; index += BATCH) database.put(this.namespace, writes.slice(index, index + BATCH));
    } catch { /* parsing remains authoritative */ }
    return values;
  }
}
