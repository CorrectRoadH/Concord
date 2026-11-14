// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from "effect";
import { createMemoryHawdb, type HawdbDatabase, type HawdbEntry, type HawdbLimits, type HawdbNamespace } from "./hawdb-native.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from '../installation/index.ts';
import { canonical, ConcordError, decode, digest, objectDigest } from "../../model/index.ts";
import { readCachePayloads, writeCachePayloads } from "./cache-query.ts";
import { ownedContentCache } from './content-cache-owner.ts';

export type ContentResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly cause: unknown };

const EnvelopeSchema = Schema.fromJsonString(Schema.Struct({ parser: Schema.String, sourceDigest: Schema.String, present: Schema.Boolean, value: Schema.optional(Schema.Unknown) }));

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
    const borrowed = ownedContentCache(this.runtime, JSON.stringify([this.namespace, this.parser, this.limits]));
    return borrowed.owned ? borrowed.database : this.database ?? (this.database = createMemoryHawdb(this.runtime));
  }

  private cachedValue(payload: string, sourceDigest: string): A {
    const envelope = decode(EnvelopeSchema, payload, 'content cache');
    if (envelope.parser !== this.parser || envelope.sourceDigest !== sourceDigest || envelope.present !== Object.hasOwn(envelope, 'value')) {
      throw new ConcordError('InvalidData', 'Content cache identity or value presence differs from the requested entry');
    }
    return decode(this.valueSchema, envelope.present ? envelope.value : undefined, 'content cache value');
  }

  private payload(value: A, sourceDigest: string): string {
    decode(this.valueSchema, value, 'content cache value');
    return canonical({ parser: this.parser, sourceDigest, present: value !== undefined, ...(value === undefined ? {} : { value }) });
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

  async getAsync(path: string, source: string, parse: (previous?: A) => A | Promise<A>, rebuild = false, accept?: (value: A) => boolean): Promise<A> {
    const result = (await this.getManyResultsAsync([{ path, source }], (_input, previous) => parse(previous), rebuild, accept))[0]!;
    if (!result.ok) throw result.cause;
    return result.value;
  }

  /** No native handle is borrowed across a parser suspension. */
  async getManyResultsAsync(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }, previous?: A) => A | Promise<A>, rebuild = false, accept?: (value: A) => boolean): Promise<ContentResult<A>[]> {
    if (inputs.length === 0) return [];
    const identities = inputs.map(input => {
      const sourceDigest = digest(input.source);
      return { input, sourceDigest, key: objectDigest({ parser: this.parser, path: input.path, sourceDigest }) };
    });
    let found = new Map<string, string>();
    let caching: boolean;
    {
      const database = this.engine();
      caching = database !== undefined;
      if (!rebuild && database !== undefined) found = new Map(readCachePayloads(database, this.namespace, identities.map(item => item.key)));
    }
    const writes: HawdbEntry[] = [];
    const values: ContentResult<A>[] = [];
    for (const { input, key, sourceDigest } of identities) {
      const payload = found.get(key);
      let previous: A | undefined;
      if (payload !== undefined) {
        const value = this.cachedValue(payload, sourceDigest);
        if (accept === undefined || accept(value)) { values.push({ ok: true, value }); continue; }
        previous = value;
      }
      let value: A;
      try { value = await parse(input, previous); }
      catch (cause) { values.push({ ok: false, cause }); continue; }
      if (caching) {
        const payload = this.payload(value, sourceDigest);
        writes.push({ key, payload });
        found.set(key, payload);
      }
      values.push({ ok: true, value });
    }
    if (writes.length > 0) {
      const database = this.engine();
      if (database !== undefined) writeCachePayloads(database, this.namespace, writes, this.limits);
    }
    return values;
  }

  /** Batch diagnostics without caching failures or hiding other files. */
  getManyResults(inputs: readonly { readonly path: string; readonly source: string }[], parse: (input: { readonly path: string; readonly source: string }, previous?: A) => A, rebuild = false, accept?: (value: A) => boolean): ContentResult<A>[] {
    if (inputs.length === 0) return [];
    const database = this.engine();
    const identities = inputs.map(input => {
      const sourceDigest = digest(input.source);
      return { input, sourceDigest, key: objectDigest({ parser: this.parser, path: input.path, sourceDigest }) };
    });
    const found = !rebuild && database !== undefined ? new Map(readCachePayloads(database, this.namespace, identities.map(item => item.key))) : new Map<string, string>();
    const writes: HawdbEntry[] = [];
    const values = identities.map(({ input, key, sourceDigest }): ContentResult<A> => {
      const payload = found.get(key);
      let previous: A | undefined;
      if (payload !== undefined) {
        const value = this.cachedValue(payload, sourceDigest);
        if (accept === undefined || accept(value)) return { ok: true, value };
        previous = value;
      }
      let value: A;
      try { value = parse(input, previous); }
      catch (cause) { return { ok: false, cause }; }
      if (database !== undefined) {
        const payload = this.payload(value, sourceDigest);
        writes.push({ key, payload });
        found.set(key, payload);
      }
      return { ok: true, value };
    });
    if (database !== undefined) writeCachePayloads(database, this.namespace, writes, this.limits);
    return values;
  }
}
