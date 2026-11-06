// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from "effect";
import { createMemoryHawdb, type HawdbDatabase, type HawdbEntry, type HawdbLimits, type HawdbNamespace } from "./hawdb-native.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from '../installation/index.ts';
import { canonical, decode, digest, objectDigest } from "../../model/index.ts";
import { readCachePayloads, writeCachePayloads } from "./cache-query.ts";
import { ownedContentCache } from './content-cache-owner.ts';

export type ContentResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly cause: unknown };

const EnvelopeSchema = Schema.Struct({ parser: Schema.String, sourceDigest: Schema.String, present: Schema.Boolean, value: Schema.optional(Schema.Unknown) });

/** Borrows an entry's parse handle or owns a short-lived one; source bytes and parser version own identity. */
export class ContentCache<A> {
  private database: HawdbDatabase | undefined;

  private readonly namespace: Extract<HawdbNamespace, 'document_parse' | 'code_parse'>;
  private readonly parser: string;
  private readonly valueSchema: Schema.ConstraintDecoder<A, never>;
  private readonly limits?: HawdbLimits;
  private readonly runtime: RuntimeEnvironmentSnapshot;
  constructor(namespace: Extract<HawdbNamespace, 'document_parse' | 'code_parse'>, parser: string, valueSchema: Schema.ConstraintDecoder<A, never>, limits?: HawdbLimits, runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})) {
    this.namespace = namespace;
    this.parser = parser;
    this.valueSchema = valueSchema;
    this.limits = limits;
    this.runtime = runtime;
  }

  private engine(): HawdbDatabase | undefined {
    try {
      const borrowed = ownedContentCache(this.runtime, JSON.stringify([this.namespace, this.parser, this.limits]));
      return borrowed.owned ? borrowed.database : this.database ?? (this.database = createMemoryHawdb(this.runtime));
    }
    catch { return undefined; }
  }

  close(): void { this.database?.close(); this.database = undefined; }

  get(path: string, source: string, parse: (previous?: A) => A, rebuild = false, accept?: (value: A) => boolean): A {
    const result = this.getManyResults([{ path, source }], (_input, previous) => parse(previous), rebuild, accept)[0]!;
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
  getManyResults(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }, previous?: A) => A, rebuild = false, accept?: (value: A) => boolean): ContentResult<A>[] {
    if (inputs.length === 0) return [];
    const database = this.engine();
    const identities = inputs.map(input => {
      const sourceDigest = digest(input.source);
      return { input, sourceDigest, key: objectDigest({ parser: this.parser, path: input.path, sourceDigest }) };
    });
    let found = new Map<string, string>();
    if (!rebuild && database !== undefined) try {
      found = new Map(readCachePayloads(database, this.namespace, identities.map(item => item.key)));
    } catch { found = new Map(); }
    const writes: HawdbEntry[] = [];
    const values = identities.map(({ input, key, sourceDigest }): ContentResult<A> => {
      const payload = found.get(key);
      let previous: A | undefined;
      if (payload !== undefined) try {
        const envelope = decode(EnvelopeSchema, JSON.parse(payload), 'content cache');
        if (envelope.parser === this.parser && envelope.sourceDigest === sourceDigest && (envelope.present || envelope.value === undefined)) {
          const value = decode(this.valueSchema, envelope.present ? envelope.value : undefined, 'content cache value');
          if (accept === undefined || accept(value)) return { ok: true, value };
          previous = value;
        }
      } catch { /* damaged cache is a miss */ }
      let value: A;
      try { value = parse(input, previous); }
      catch (cause) { return { ok: false, cause }; }
      try {
        const payload = canonical({ parser: this.parser, sourceDigest, present: value !== undefined, ...(value === undefined ? {} : { value }) });
        writes.push({ key, payload });
        found.set(key, payload);
      }
      catch { /* uncacheable parse output is still returned */ }
      return { ok: true, value };
    });
    if (database !== undefined) try {
      writeCachePayloads(database, this.namespace, writes, this.limits);
    } catch { /* parsing remains authoritative */ }
    return values;
  }
}
