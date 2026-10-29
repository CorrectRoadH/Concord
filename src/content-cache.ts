// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from 'effect';
import { createMemoryHawdb, type HawdbDatabase, type HawdbEntry, type HawdbLimits, type HawdbNamespace } from './hawdb-native.js';
import { canonical, decode, digest, objectDigest } from './shared.js';
import { readCachePayloads, writeCachePayloads } from './cache-query.js';
import { currentCacheRepository } from './cache-context.js';
import { withPersistentCache } from './cache-store.js';

export type ContentResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly cause: unknown };

const EnvelopeSchema = Schema.Struct({ parser: Schema.String, path: Schema.String, sourceDigest: Schema.String, valueDigest: Schema.String, present: Schema.Boolean, value: Schema.optional(Schema.Unknown) });

/** Owns only a bounded HawDB handle; caller source bytes and parser version own identity. */
export class ContentCache<A> {
  private database: HawdbDatabase | undefined;

  constructor(private readonly namespace: Extract<HawdbNamespace, 'document_parse' | 'code_parse'>, private readonly parser: string, private readonly valueSchema: Schema.ConstraintDecoder<A, never>, private readonly limits?: HawdbLimits, private readonly persistent?: 'document_parse_cache') {}

  private engine(): HawdbDatabase | undefined {
    try { return this.database ?? (this.database = createMemoryHawdb()); }
    catch { return undefined; }
  }

  close(): void { this.database?.close(); this.database = undefined; }

  get(path: string, source: string, parse: () => A, rebuild = false): A {
    const result = this.getManyResults([{ path, source }], () => parse(), rebuild)[0]!;
    if (!result.ok) throw result.cause;
    return result.value;
  }

  getMany(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }) => A): A[] {
    return this.getManyResults(inputs, parse).map(result => {
      if (!result.ok) throw result.cause;
      return result.value;
    });
  }

  /** Batch diagnostics without caching failures or hiding other files. */
  getManyResults(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }) => A, rebuild = false): ContentResult<A>[] {
    if (inputs.length === 0) return [];
    const database = this.engine();
    const identities = inputs.map(input => {
      const sourceDigest = digest(input.source);
      return { input, sourceDigest, key: objectDigest({ parser: this.parser, path: input.path, sourceDigest }), persistentKey: objectDigest({ parser: this.parser, path: input.path }) };
    });
    let found: ReadonlyMap<string, string> = new Map();
    if (!rebuild && database !== undefined) try {
      found = readCachePayloads(database, this.namespace, identities.map(item => item.key));
    } catch { found = new Map(); }
    const repo = this.persistent === undefined ? undefined : currentCacheRepository();
    let persisted: ReadonlyMap<string, string> = new Map();
    const absent = identities.filter(item => !found.has(item.key));
    if (!rebuild && repo !== undefined && repo.persistentCache !== 'off' && absent.length > 0) try {
      persisted = withPersistentCache(repo, false, db => db === undefined ? new Map<string, string>() : readCachePayloads(db, this.persistent!, absent.map(item => item.persistentKey)));
    } catch { /* current bytes remain authoritative */ }
    const writes: HawdbEntry[] = [], persistentWrites: HawdbEntry[] = [];
    const values = identities.map(({ input, key, persistentKey, sourceDigest }): ContentResult<A> => {
      const payload = found.get(key) ?? persisted.get(persistentKey);
      if (payload !== undefined) try {
        const envelope = decode(EnvelopeSchema, JSON.parse(payload), 'content cache');
        if (envelope.parser === this.parser && envelope.path === input.path && envelope.sourceDigest === sourceDigest && envelope.valueDigest === objectDigest(envelope.value) && (envelope.present || envelope.value === undefined)) {
          const value = decode(this.valueSchema, envelope.present ? envelope.value : undefined, 'content cache value');
          if (!found.has(key)) writes.push({ key, payload });
          return { ok: true, value };
        }
      } catch { /* damaged cache is a miss */ }
      let value: A;
      try { value = parse(input); }
      catch (cause) { return { ok: false, cause }; }
      try {
        const payload = canonical({ parser: this.parser, path: input.path, sourceDigest, valueDigest: objectDigest(value), present: value !== undefined, ...(value === undefined ? {} : { value }) });
        writes.push({ key, payload });
        persistentWrites.push({ key: persistentKey, payload });
      }
      catch { /* uncacheable parse output is still returned */ }
      return { ok: true, value };
    });
    if (database !== undefined) try {
      writeCachePayloads(database, this.namespace, writes, this.limits);
    } catch { /* parsing remains authoritative */ }
    if (repo !== undefined && repo.persistentCache !== 'off' && persistentWrites.length > 0) try {
      withPersistentCache(repo, true, db => writeCachePayloads(db!, this.persistent!, persistentWrites));
    } catch { /* a missing projection never changes source facts */ }
    return values;
  }
}
