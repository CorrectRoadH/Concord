import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { HAWDB_ABI, HAWDB_REVISION, decodeNativeArtifact, hawdbTarget } from './hawdb-native-contract.js';

export { HAWDB_ABI, HAWDB_REVISION };
export type HawdbNamespace = 'document_parse' | 'code_parse' | 'git_baseline' | 'annotation_cache' | 'code_cache' | 'config_cache' | 'feedback_cache';
export interface HawdbEntry { readonly key: string; readonly payload: string; }
export interface HawdbLimits { readonly maxEntries: number; readonly maxBytes: number; }
export interface HawdbDatabase {
  get(namespace: HawdbNamespace, keys: readonly string[]): readonly HawdbEntry[];
  scan(namespace: HawdbNamespace): readonly HawdbEntry[];
  put(namespace: HawdbNamespace, entries: readonly HawdbEntry[], limits?: HawdbLimits): void;
  clearNamespace(namespace: HawdbNamespace): void;
  namespaces(): readonly HawdbNamespace[];
  close(): void;
}
export type HawdbFailureCode = 'HawdbBusy' | 'HawdbUnavailable' | 'HawdbIncompatible' | 'HawdbLimit' | 'HawdbClosed' | 'UnsafePath';
export class HawdbFailure extends Error {
  constructor(readonly code: HawdbFailureCode, message: string, options?: ErrorOptions) {
    super(message, options); this.name = code;
  }
}
const EntrySchema = Schema.Struct({ key: Schema.String, payload: Schema.String });
const NamespaceSchema = Schema.Literals(['document_parse', 'code_parse', 'git_baseline', 'annotation_cache', 'code_cache', 'config_cache', 'feedback_cache']);
const OptionsSchema = Schema.Struct({ readOnly: Schema.Boolean, create: Schema.Boolean });
const KeysSchema = Schema.Array(Schema.String);
const decodeNamespace = Schema.decodeUnknownSync(NamespaceSchema, { errors: 'all' });
const decodeOptions = Schema.decodeUnknownSync(OptionsSchema, { onExcessProperty: 'error', errors: 'all' });
const decodePath = Schema.decodeUnknownSync(Schema.String, { errors: 'all' });
const decodeKeys = Schema.decodeUnknownSync(KeysSchema, { errors: 'all' });
const EntriesSchema = Schema.Array(EntrySchema);
const NamespacesSchema = Schema.Array(NamespaceSchema);
const IdentitySchema = Schema.Struct({ revision: Schema.Literal(HAWDB_REVISION), abi: Schema.Literal(HAWDB_ABI) });
const readEntries = Schema.decodeUnknownSync(EntriesSchema, { onExcessProperty: 'error', errors: 'all' });
const readNamespaces = Schema.decodeUnknownSync(NamespacesSchema, { errors: 'all' });
const readIdentity = Schema.decodeUnknownSync(IdentitySchema, { onExcessProperty: 'error', errors: 'all' });
const failureCodes = new Set<HawdbFailureCode>(['HawdbBusy', 'HawdbUnavailable', 'HawdbIncompatible', 'HawdbLimit', 'HawdbClosed', 'UnsafePath']);
function asFailure(error: unknown): HawdbFailure {
  if (error instanceof HawdbFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.slice(0, message.indexOf(':')) as HawdbFailureCode;
  return new HawdbFailure(failureCodes.has(prefix) ? prefix : 'HawdbUnavailable', message, { cause: error });
}
function boundary<T>(operation: () => T): T {
  try { return Effect.runSync(Effect.sync(operation)); }
  catch (error) { throw asFailure(error); }
}
interface NativeBridge {
  get(namespace: string, keys: string[]): unknown;
  scan(namespace: string): unknown;
  put(namespace: string, entries: HawdbEntry[], quota?: { maxEntries: number; maxBytes: number }): void;
  clearNamespace(namespace: string): void;
  namespaces(): unknown;
  close(): void;
}
interface NativeModule {
  nativeIdentity(): unknown;
  CacheBridge: { new(path: string, readOnly: boolean, create: boolean): NativeBridge; memory(): NativeBridge };
  OwnerGuard: new(path: string) => { close(): void };
}
let loaded: NativeModule | undefined;
function load(): NativeModule {
  if (loaded) return loaded;
  const target = hawdbTarget();
  const base = fileURLToPath(new URL(`../dist/native/${target}/`, import.meta.url));
  const metadata = decodeNativeArtifact(JSON.parse(readFileSync(join(base, 'artifact.json'), 'utf8')));
  if (metadata.target !== target || metadata.sourceDigest.length !== 64 || metadata.cargoLockDigest.length !== 64 || metadata.binarySha256.length !== 64 || metadata.noticesSha256.length !== 64) {
    throw new HawdbFailure('HawdbIncompatible', 'native artifact identity is incomplete');
  }
  if (target === 'darwin-arm64' && metadata.deploymentTarget !== '14.0') {
    throw new HawdbFailure('HawdbIncompatible', 'macOS deployment target differs');
  }
  const noticesDigest = createHash('sha256').update(readFileSync(join(base, 'THIRD-PARTY-NOTICES.txt'))).digest('hex');
  if (noticesDigest !== metadata.noticesSha256) throw new HawdbFailure('HawdbIncompatible', 'native notices digest differs');
  const binary = join(base, 'hawdb.node');
  const digest = createHash('sha256').update(readFileSync(binary)).digest('hex');
  if (digest !== metadata.binarySha256) throw new HawdbFailure('HawdbIncompatible', 'native binary digest differs');
  const native = createRequire(import.meta.url)(binary) as NativeModule;
  readIdentity(native.nativeIdentity());
  loaded = native;
  return native;
}
class Database implements HawdbDatabase {
  constructor(private readonly native: NativeBridge) {}
  get(namespace: HawdbNamespace, keys: readonly string[]): readonly HawdbEntry[] {
    return boundary(() => readEntries(this.native.get(decodeNamespace(namespace), [...decodeKeys(keys)])));
  }
  scan(namespace: HawdbNamespace): readonly HawdbEntry[] {
    return boundary(() => readEntries(this.native.scan(decodeNamespace(namespace))));
  }
  put(namespace: HawdbNamespace, entries: readonly HawdbEntry[], limits?: HawdbLimits): void {
    boundary(() => {
      const decoded = readEntries(entries);
      if (limits && (!Number.isSafeInteger(limits.maxEntries) || !Number.isSafeInteger(limits.maxBytes) || limits.maxEntries < 1 || limits.maxBytes < 1 || limits.maxEntries > 0xffffffff || limits.maxBytes > 0xffffffff)) {
        throw new HawdbFailure('HawdbLimit', 'invalid quota');
      }
      this.native.put(decodeNamespace(namespace), [...decoded], limits ? { maxEntries: limits.maxEntries, maxBytes: limits.maxBytes } : undefined);
    });
  }
  clearNamespace(namespace: HawdbNamespace): void { boundary(() => this.native.clearNamespace(decodeNamespace(namespace))); }
  namespaces(): readonly HawdbNamespace[] { return boundary(() => readNamespaces(this.native.namespaces())); }
  close(): void { boundary(() => this.native.close()); }
}
export function openHawdb(path: string, options: { readonly readOnly: boolean; readonly create: boolean }): HawdbDatabase {
  return boundary(() => { const mode = decodeOptions(options); return new Database(new (load().CacheBridge)(decodePath(path), mode.readOnly, mode.create)); });
}
export function createMemoryHawdb(): HawdbDatabase { return boundary(() => new Database(load().CacheBridge.memory())); }
export function acquireHawdbClearGuard(path: string): { close(): void } {
  return boundary(() => {
    const guard = new (load().OwnerGuard)(decodePath(path));
    return { close: () => boundary(() => guard.close()) };
  });
}
export function hawdbIdentity(): { readonly engine: 'hawdb'; readonly revision: string; readonly abi: string; readonly target: string } {
  return boundary(() => { load(); return { engine: 'hawdb', revision: HAWDB_REVISION, abi: HAWDB_ABI, target: hawdbTarget() }; });
}
