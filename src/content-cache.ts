// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from 'effect';
import { createMemoryHawdb, type HawdbDatabase, type HawdbEntry, type HawdbLimits, type HawdbNamespace } from './hawdb-native.js';
import { canonical, decode, digest, objectDigest } from './shared.js';
import { readCachePayloads, writeCachePayloads } from './cache-query.js';

export type ContentResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly cause: unknown };

const EnvelopeSchema = Schema.Struct({ parser: Schema.String, sourceDigest: Schema.String, present: Schema.Boolean, value: Schema.optional(Schema.Unknown) });

/** Owns only a bounded HawDB handle; caller source bytes and parser version own identity. */
export class ContentCache<A> {
  private database: HawdbDatabase | undefined;

  constructor(private readonly namespace: Extract<HawdbNamespace, 'document_parse' | 'code_parse'>, private readonly parser: string, private readonly valueSchema: Schema.ConstraintDecoder<A, never>, private readonly limits?: HawdbLimits) {}

  private engine(): HawdbDatabase | undefined {
    try { return this.database ?? (this.database = createMemoryHawdb()); }
    catch { return undefined; }
  }

  close(): void { this.database?.close(); this.database = undefined; }

  get(path: string, source: string, parse: () => A): A {
    return this.getMany([{ path, source }], () => parse())[0]!;
  }

  getMany(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }) => A): A[] {
    return this.getManyResults(inputs, parse).map(result => {
      if (!result.ok) throw result.cause;
      return result.value;
    });
  }

  /** Batch diagnostics without caching failures or hiding other files. */
  getManyResults(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }) => A): ContentResult<A>[] {
    if (inputs.length === 0) return [];
    const database = this.engine();
    const identities = inputs.map(input => {
      const sourceDigest = digest(input.source);
      return { input, sourceDigest, key: objectDigest({ parser: this.parser, path: input.path, sourceDigest }) };
    });
    let found: ReadonlyMap<string, string> = new Map();
    if (database !== undefined) try {
      found = readCachePayloads(database, this.namespace, identities.map(item => item.key));
    } catch { found = new Map(); }
    const writes: HawdbEntry[] = [];
    const values = identities.map(({ input, key, sourceDigest }): ContentResult<A> => {
      const payload = found.get(key);
      if (payload !== undefined) try {
        const envelope = decode(EnvelopeSchema, JSON.parse(payload), 'content cache');
        if (envelope.parser === this.parser && envelope.sourceDigest === sourceDigest && (envelope.present || envelope.value === undefined)) {
          return { ok: true, value: decode(this.valueSchema, envelope.present ? envelope.value : undefined, 'content cache value') };
        }
      } catch { /* damaged cache is a miss */ }
      let value: A;
      try { value = parse(input); }
      catch (cause) { return { ok: false, cause }; }
      try { writes.push({ key, payload: canonical({ parser: this.parser, sourceDigest, present: value !== undefined, ...(value === undefined ? {} : { value }) }) }); }
      catch { /* uncacheable parse output is still returned */ }
      return { ok: true, value };
    });
    if (database !== undefined) try {
      writeCachePayloads(database, this.namespace, writes, this.limits);
    } catch { /* parsing remains authoritative */ }
    return values;
  }
}
