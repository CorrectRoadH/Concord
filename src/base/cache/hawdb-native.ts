// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#原生边界
import { loadHawDB, HawDBError, type Database as OfficialDatabase, type HawDBLibrary, type Transaction, type HawDBParameter } from '@nowledge/hawdb-bun';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { ConcordError } from '../../model/index.ts';
import { HAWDB_REVISION, HAWDB_VERSION, hawdbTarget, nativeFileIdentity, packageRoot, sourceInstallation, verifiedHawdbLibrary } from '../installation/index.ts';
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { acquireFileLock, FileLockFailure, type FileLock } from '../file-lock/index.ts';
import { assertCacheDatabaseSafe, inspectCacheClear, cacheSchemaIdentity } from './cache-file.ts';
import { initializeKnowledgeSchema } from './hawdb-search.ts';
import { HawdbEntry, HawdbFailure, HawdbLimits, HawdbNamespace, MIB, entryBytes, memoryNamespaces, persistentNamespaces, quotas } from './hawdb-types.ts';
export { HawdbFailure, HawdbEntry, HawdbLimits, HawdbNamespace } from './hawdb-types.ts';
export type { HawdbFailureCode } from './hawdb-types.ts';
export { HAWDB_REVISION, HAWDB_VERSION };
export { acquireHawdbClearGuard } from './hawdb-lock.ts';

const defaultRuntime = makeRuntimeEnvironment(packageRoot, {});
const cacheSchema = 'concord.cache/v2';
const decodeEntries = Schema.decodeUnknownSync(Schema.Array(HawdbEntry), { onExcessProperty: 'error' });
const decodeNamespace = Schema.decodeUnknownSync(HawdbNamespace);
const utf8 = new TextDecoder('utf-8', { fatal: true });
export function hawdbFailure(cause: unknown): HawdbFailure {
  if (cause instanceof HawdbFailure) return cause;
  if (cause instanceof ConcordError && cause.code === 'UnsafePath') return new HawdbFailure('UnsafePath', cause.message, { cause });
  if (cause instanceof FileLockFailure) return new HawdbFailure(cause.reason === 'busy' ? 'HawdbBusy' : ['type', 'identity'].includes(cause.reason) ? 'UnsafePath' : 'HawdbUnavailable', cause.message, { cause });
  if (cause instanceof HawDBError) return new HawdbFailure(cause.kind === 'branch_busy' ? 'HawdbBusy' : ['resource_budget_exceeded', 'admission'].includes(cause.kind) ? 'HawdbLimit' : 'HawdbUnavailable', `${cause.kind}: ${cause.message}`, { cause });
  return new HawdbFailure('HawdbUnavailable', cause instanceof Error ? cause.message : String(cause), { cause });
}
export function acquireHawdbOwnerGate(path: string): FileLock {
  try { return acquireFileLock(join(dirname(path), 'cache.hawdb.concord.lock')); }
  catch (cause) {
    if (cause instanceof FileLockFailure && cause.reason === 'busy') throw new HawdbFailure('HawdbBusy', 'Persistent cache is owned by another command', { cause });
    throw hawdbFailure(cause);
  }
}
export function verifyHawdbArtifact(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): void {
  try { verifiedHawdbLibrary(runtime); }
  catch (cause) {
    const error = hawdbFailure(cause);
    throw new HawdbFailure(error.code, `${error.message}. ${sourceInstallation ? 'Run bun run build:native.' : 'Reinstall Concord for this platform.'}`, { cause });
  }
}
export const validateHawdbArtifact = verifyHawdbArtifact;
export function hawdbIdentity(runtime: RuntimeEnvironmentSnapshot = defaultRuntime) {
  verifyHawdbArtifact(runtime);
  return { engine: 'hawdb' as const, revision: HAWDB_REVISION, version: HAWDB_VERSION, target: hawdbTarget() };
}
export interface HawdbDatabase {
  get(namespace: HawdbNamespace, keys: readonly string[]): readonly HawdbEntry[];
  scan(namespace: HawdbNamespace): readonly HawdbEntry[];
  put(namespace: HawdbNamespace, entries: readonly HawdbEntry[], limits?: HawdbLimits): void;
  clearNamespace(namespace: HawdbNamespace): void;
  namespaces(): readonly HawdbNamespace[];
  atomic<A>(run: () => A, check?: () => void): A;
  close(): void;
  closeAsync(): Promise<void>;
}
interface CacheRow extends HawdbEntry { readonly sequence: number; readonly namespace: HawdbNamespace }
function safeInteger(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result)) throw new HawdbFailure('HawdbIncompatible', 'Invalid cache integer');
  return result;
}
/** The official library and every database belong to this explicit owner. */
export class NativeDatabase implements HawdbDatabase {
  private transaction: Transaction | undefined;
  private check: (() => void) | undefined;
  private closed = false;
  private poisoned = false;
  private churn = 0;
  private database: OfficialDatabase;
  private readonly library: HawDBLibrary;
  readonly memory: boolean;
  private readonly readOnly: boolean;
  private readonly gate: FileLock | undefined;
  private readonly ownsGate: boolean;
  constructor(database: OfficialDatabase, library: HawDBLibrary, memory: boolean, readOnly: boolean, gate?: FileLock, ownsGate = true) {
    this.database = database; this.library = library; this.memory = memory; this.readOnly = readOnly; this.gate = gate; this.ownsGate = ownsGate;
  }
  private ready(): void {
    this.check?.();
    if (this.closed) throw new HawdbFailure('HawdbClosed', 'Database is closed');
    if (this.poisoned) throw new HawdbFailure('HawdbCommitUnknown', 'Close and reopen the database before reusing it');
    try { this.gate?.verify(); } catch (cause) { throw hawdbFailure(cause); }
  }
  query(cypher: string, parameters: Record<string, HawDBParameter> = {}) {
    this.ready();
    try { return (this.transaction ?? this.database).query(cypher, parameters).dicts(); }
    catch (cause) { throw hawdbFailure(cause); }
  }
  exec(cypher: string, parameters: Record<string, HawDBParameter> = {}): void { this.query(cypher, parameters); }
  sql(sql: string, parameters: HawDBParameter[] = []) {
    this.ready();
    try { return (this.transaction ?? this.database).querySQL(sql, parameters).dicts(); }
    catch (cause) { throw hawdbFailure(cause); }
  }
  atomic<A>(run: () => A, check?: () => void): A {
    this.ready();
    if (this.readOnly) throw new HawdbFailure('HawdbIncompatible', 'A readonly database cannot start a write transaction');
    if (this.transaction) return run();
    let completed = false;
    try {
      return this.database.transaction(transaction => {
        this.transaction = transaction;
        this.check = check;
        try {
          const value = run();
          if (value instanceof Promise) throw new HawdbFailure('HawdbIncompatible', 'Native transaction callbacks must be synchronous');
          completed = true;
          return value;
        } finally { this.transaction = undefined; this.check = undefined; }
      });
    } catch (cause) {
      if (!completed) throw cause;
      this.poisoned = true;
      throw new HawdbFailure('HawdbCommitUnknown', 'Commit outcome is unknown; discard observations and reopen before reconciliation', { cause });
    }
  }
  initialize(): void {
    this.atomic(() => {
      this.sql('CREATE TABLE concord_cache_entries (namespace TEXT NOT NULL, cache_key TEXT NOT NULL, payload BYTEA NOT NULL, sequence BIGINT NOT NULL, PRIMARY KEY (namespace, cache_key))');
      this.sql('CREATE TABLE concord_cache_schema (version TEXT NOT NULL PRIMARY KEY)');
      this.sql('INSERT INTO concord_cache_schema (version) VALUES ($1)', [cacheSchema]);
      initializeKnowledgeSchema(this);
    });
  }
  verifySchema(): void {
    const rows = this.sql('SELECT version FROM concord_cache_schema LIMIT 2');
    const decoded = Schema.decodeUnknownExit(Schema.Array(Schema.Struct({ version: Schema.String.check(Schema.isPattern(/^concord\.cache\/v[0-9]+$/u)) })), { onExcessProperty: 'error' })(rows);
    if (decoded._tag === 'Failure' || decoded.value.length !== 1) throw new HawdbFailure('HawdbIncompatible', 'Cache schema identity is missing or invalid; inspect it before explicit clear');
    if (decoded.value[0]!.version !== cacheSchema) throw new HawdbFailure('HawdbCacheSchemaMismatch', `Cache schema ${decoded.value[0]!.version} differs from ${cacheSchema}`);
  }
  namespaces(): readonly HawdbNamespace[] { this.ready(); return this.memory ? memoryNamespaces : persistentNamespaces; }
  private quota(namespace: HawdbNamespace): HawdbLimits {
    decodeNamespace(namespace);
    if (!this.namespaces().includes(namespace)) throw new HawdbFailure('HawdbIncompatible', `Namespace ${namespace} is unavailable in this database`);
    return quotas[namespace];
  }
  private rows(namespace: HawdbNamespace): CacheRow[] {
    const quota = this.quota(namespace), rows: CacheRow[] = [];
    let bytes = 0, after = -1;
    while (true) {
      const page = this.sql('SELECT cache_key, payload, sequence FROM concord_cache_entries WHERE namespace = $1 AND sequence > $2 ORDER BY sequence LIMIT 1000', [namespace, after]);
      for (const row of page) {
        if (typeof row.cache_key !== 'string' || !(row.payload instanceof Uint8Array)) throw new HawdbFailure('HawdbIncompatible', 'Invalid cache row shape');
        const value = { namespace, key: row.cache_key, payload: utf8.decode(row.payload), sequence: safeInteger(row.sequence) };
        if (value.sequence <= after) throw new HawdbFailure('HawdbIncompatible', 'Cache sequence is not strictly increasing');
        after = value.sequence; bytes += entryBytes(namespace, value); rows.push(value);
        if (rows.length > quota.maxEntries || bytes > quota.maxBytes) throw new HawdbFailure('HawdbLimit', 'Cache namespace exceeds its read budget');
      }
      if (page.length < 1000) return rows;
    }
  }
  scan(namespace: HawdbNamespace): readonly HawdbEntry[] { return this.rows(namespace).map(({ key, payload }) => ({ key, payload })); }
  get(namespace: HawdbNamespace, keys: readonly string[]): readonly HawdbEntry[] {
    this.quota(namespace);
    if (keys.length > 1000 || keys.some(key => typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 8 * MIB)) throw new HawdbFailure('HawdbLimit', 'Invalid cache key batch');
    if (!keys.length) return [];
    const rows = this.sql(`SELECT cache_key, payload FROM concord_cache_entries WHERE namespace = $1 AND cache_key IN (${keys.map((_, index) => `$${index + 2}`).join(',')})`, [namespace, ...keys]);
    const found = new Map<string, string>();
    let bytes = 0;
    for (const row of rows) {
      if (typeof row.cache_key !== 'string' || !(row.payload instanceof Uint8Array) || found.has(row.cache_key)) throw new HawdbFailure('HawdbIncompatible', 'Invalid cache read result');
      bytes += row.payload.byteLength;
      if (bytes > 64 * MIB) throw new HawdbFailure('HawdbLimit', 'Cache read exceeds 64 MiB');
      found.set(row.cache_key, utf8.decode(row.payload));
    }
    return keys.flatMap(key => { const payload = found.get(key); return payload === undefined ? [] : [{ key, payload }]; });
  }
  cacheBytes(): number { return this.namespaces().flatMap(namespace => this.rows(namespace)).reduce((total, row) => total + entryBytes(row.namespace, row), 0); }
  put(namespace: HawdbNamespace, input: readonly HawdbEntry[], limits?: HawdbLimits): void {
    const quota = this.quota(namespace), entries = decodeEntries(input);
    if (limits) Schema.decodeUnknownSync(HawdbLimits, { onExcessProperty: 'error' })(limits);
    const maxEntries = Math.min(quota.maxEntries, limits?.maxEntries ?? quota.maxEntries), maxBytes = Math.min(quota.maxBytes, limits?.maxBytes ?? quota.maxBytes);
    if (maxEntries < 1 || maxBytes < 1 || entries.length > 1000 || entries.some(row => !row.key.length || entryBytes(namespace, row) > 8 * MIB) || entries.reduce((n, row) => n + entryBytes(namespace, row), 0) > 16 * MIB) throw new HawdbFailure('HawdbLimit', 'Cache input exceeds its batch budget');
    const incoming = new Map<string, HawdbEntry>();
    for (const row of entries) { incoming.delete(row.key); incoming.set(row.key, row); }
    const additions = [...incoming.values()], inputBytes = additions.reduce((n, row) => n + entryBytes(namespace, row), 0);
    if (incoming.size > maxEntries || inputBytes > maxBytes) throw new HawdbFailure('HawdbLimit', 'Incoming batch exceeds namespace quota');
    if (!incoming.size) return;
    this.atomic(() => {
      const all = this.namespaces().flatMap(name => this.rows(name));
      let sequence = all.reduce((n, row) => Math.max(n, row.sequence), 0);
      const remaining = all.filter(row => row.namespace === namespace && !incoming.has(row.key));
      const deletes = new Set(incoming.keys());
      let bytes = remaining.reduce((n, row) => n + entryBytes(namespace, row), inputBytes), count = remaining.length + additions.length;
      for (const row of remaining) {
        if (bytes <= maxBytes && count <= maxEntries) break;
        deletes.add(row.key); bytes -= entryBytes(namespace, row); count--;
      }
      const otherBytes = all.filter(row => row.namespace !== namespace).reduce((n, row) => n + entryBytes(row.namespace, row), 0);
      const searchBytes = this.memory ? 0 : this.searchLogicalBytes();
      if (otherBytes + bytes + searchBytes > (this.memory ? 36 : 96) * MIB) throw new HawdbFailure('HawdbLimit', 'Shared cache budget exceeded');
      for (const key of deletes) this.sql('DELETE FROM concord_cache_entries WHERE namespace = $1 AND cache_key = $2', [namespace, key]);
      const parameters: HawDBParameter[] = [];
      const values = additions.map(row => {
        sequence++;
        if (!Number.isSafeInteger(sequence)) throw new HawdbFailure('HawdbLimit', 'Cache sequence exhausted');
        const start = parameters.length;
        parameters.push(namespace, row.key, new TextEncoder().encode(row.payload), sequence);
        return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4})`;
      });
      this.sql(`INSERT INTO concord_cache_entries (namespace, cache_key, payload, sequence) VALUES ${values.join(',')}`, parameters);
    });
    this.churn += inputBytes;
    if (this.memory && this.transaction === undefined && this.churn > 72 * MIB) this.rebuildMemory();
  }
  searchLogicalBytes(): number {
    return this.query('MATCH (g:KnowledgeSearchGeneration) RETURN g.logicalBytes AS bytes').reduce((n, row) => n + safeInteger(row.bytes), 0);
  }
  clearNamespace(namespace: HawdbNamespace): void { this.quota(namespace); this.atomic(() => { this.sql('DELETE FROM concord_cache_entries WHERE namespace = $1', [namespace]); }); }
  private rebuildMemory(): void {
    const rows = this.namespaces().map(namespace => ({ namespace, rows: this.rows(namespace) }));
    const old = this.database;
    this.churn = 0;
    this.database = this.library.openInMemory();
    try {
      this.initialize();
      for (const group of rows) for (let start = 0; start < group.rows.length; start += 1000) this.put(group.namespace, group.rows.slice(start, start + 1000));
      old.close(); this.churn = 0;
    } catch (cause) { this.database.close(); this.database = old; throw cause; }
  }
  close(): void {
    if (this.closed) return;
    this.database.close(); this.library.close();
    this.closed = true;
    if (this.ownsGate) this.gate?.close();
  }
  async closeAsync(): Promise<void> { this.close(); }
}
/** This evidence stays inside the database Worker; a serialized code alone cannot authorize deletion. */
export class CacheSchemaMismatch extends HawdbFailure {
  readonly observation: string;
  constructor(message: string, observation: string) { super('HawdbCacheSchemaMismatch', message); this.observation = observation; }
}
function open(path: string | undefined, options: { readonly readOnly: boolean; readonly create: boolean }, runtime: RuntimeEnvironmentSnapshot, borrowedGate?: FileLock): NativeDatabase {
  let library: HawDBLibrary | undefined, database: OfficialDatabase | undefined, gate: FileLock | undefined;
  try {
    if (options.readOnly && options.create) throw new HawdbFailure('HawdbIncompatible', 'Readonly create is invalid');
    let initialize = path === undefined;
    if (path !== undefined) {
      const existing = assertCacheDatabaseSafe(path);
      if (!existing && !options.create) throw new HawdbFailure('HawdbUnavailable', 'Cache directory is absent');
      gate = borrowedGate ?? acquireHawdbOwnerGate(path);
      initialize = !existing || inspectCacheClear(dirname(path)).empty;
      if (initialize && !options.create) throw new HawdbFailure('HawdbUnavailable', 'Cache is empty');
      if (!existing) mkdirSync(path);
      inspectCacheClear(dirname(path));
    }
    const artifact = verifiedHawdbLibrary(runtime);
    library = loadHawDB(artifact.binary);
    if (nativeFileIdentity(artifact.binary) !== artifact.identity || library.version() !== `hawdb ${artifact.version}`) throw new HawdbFailure('HawdbIncompatible', 'Loaded HawDB library identity differs');
    database = path === undefined ? library.openInMemory() : library.open(path, { readOnly: options.readOnly, durability: 'sync_on_every_write', maxReadResultRows: 20000, maxReadResultPayloadBytes: 64 * MIB });
    const owner = new NativeDatabase(database, library, path === undefined, options.readOnly, gate, borrowedGate === undefined);
    if (initialize) owner.initialize(); else owner.verifySchema();
    gate?.verify();
    return owner;
  } catch (cause) {
    let error = hawdbFailure(cause);
    try {
      const nativeCause = cause instanceof HawDBError ? cause : error.cause;
      const unsupportedStorage = database !== undefined && nativeCause instanceof HawDBError && nativeCause.kind === 'unsupported_storage_format';
      if (path !== undefined && !options.readOnly && (error.code === 'HawdbCacheSchemaMismatch' || unsupportedStorage)) error = new CacheSchemaMismatch(error.message, cacheSchemaIdentity(path));
    } catch (observationFailure) { error = hawdbFailure(observationFailure); }
    try { database?.close(); library?.close(); } finally { if (borrowedGate === undefined) gate?.close(); }
    throw error;
  }
}
export const openHawdb = (path: string, options: { readonly readOnly: boolean; readonly create: boolean }, runtime: RuntimeEnvironmentSnapshot = defaultRuntime, gate?: FileLock): NativeDatabase => open(path, options, runtime, gate);
export const createMemoryHawdb = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime): NativeDatabase => open(undefined, { readOnly: false, create: true }, runtime);
