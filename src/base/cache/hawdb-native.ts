import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { nativeArtifactRoot, nativeFileDigest, nativeFileIdentity, sourceInstallation, verifySourceNativeArtifact } from "../installation/index.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from '../installation/index.ts';
import { Effect, Schema } from "effect";
import { HAWDB_ABI, HAWDB_REVISION, HAWDB_MACOS_DEPLOYMENT_TARGET, decodeNativeArtifact, hawdbTarget } from "../installation/index.ts";

export { HAWDB_ABI, HAWDB_REVISION };
export type HawdbNamespace = 'document_parse' | 'code_parse' | 'git_baseline' | 'annotation_cache' | 'code_cache' | 'config_cache' | 'feedback_cache' | 'query_cache' | 'workspace_projection';
export interface HawdbEntry { readonly key: string; readonly payload: string; }
export interface HawdbLimits { readonly maxEntries: number; readonly maxBytes: number; }
export interface HawdbReclamation { readonly reclaimedObjects: number; readonly reclaimedBytes: number; readonly deferredForActiveLeases: boolean }
export interface HawdbDatabase {
  get(namespace: HawdbNamespace, keys: readonly string[]): readonly HawdbEntry[];
  scan(namespace: HawdbNamespace): readonly HawdbEntry[];
  put(namespace: HawdbNamespace, entries: readonly HawdbEntry[], limits?: HawdbLimits): void;
  clearNamespace(namespace: HawdbNamespace): void;
  namespaces(): readonly HawdbNamespace[];
  reclaim(): HawdbReclamation;
  close(): void;
  closeAsync(): Promise<void>;
}
export type HawdbFailureCode = 'HawdbBusy' | 'HawdbUnavailable' | 'HawdbIncompatible' | 'HawdbLimit' | 'HawdbClosed' | 'UnsafePath';
export class HawdbFailure extends Error {
  readonly code: HawdbFailureCode;
  constructor(code: HawdbFailureCode, message: string, options?: ErrorOptions) {
    super(message, options); this.code = code; this.name = code;
  }
}
const EntrySchema = Schema.Struct({ key: Schema.String, payload: Schema.String });
const NamespaceSchema = Schema.Literals(['document_parse', 'code_parse', 'git_baseline', 'annotation_cache', 'code_cache', 'config_cache', 'feedback_cache', 'query_cache', 'workspace_projection']);
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
  const code = failureCodes.has(prefix) ? prefix : 'HawdbUnavailable';
  return new HawdbFailure(code, code === 'HawdbUnavailable' ? `${message}; run bun run build:native to prepare native artifacts.` : message, { cause: error });
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
  reclaim(): unknown;
  close(): void;
  closeAsync(): Promise<void>;
}
interface NativeModule {
  nativeIdentity(): unknown;
  openCache(path: string, readOnly: boolean, create: boolean): Promise<NativeBridge>;
  CacheBridge: { new(path: string, readOnly: boolean, create: boolean): NativeBridge; memory(): NativeBridge };
  OwnerGuard: new(path: string) => { verify(): void; close(): void };
}
const defaultRuntime = makeRuntimeEnvironment(packageRoot, {});
const loaded = new Map<string, NativeModule>();
const rejected = new Map<string, { readonly error: HawdbFailure; readonly retryAt: number }>();
function load(runtime: RuntimeEnvironmentSnapshot, revalidate = false): NativeModule {
  const base = join(nativeArtifactRoot(runtime), hawdbTarget());
  let binary = join(base, 'hawdb.node'), manifest = '', binaryDigest: string | undefined;
  try { binary = realpathSync(binary); } catch { /* Missing artifacts still get bounded failure retry. */ }
  try { manifest = readFileSync(join(base, 'artifact.json'), 'utf8'); binaryDigest = decodeNativeArtifact(JSON.parse(manifest)).binarySha256; } catch { /* Verification reports the authoritative error. */ }
  // Only failures are indexed before byte verification. No candidate identity
  // authorizes a loaded binding; successful lookup uses verified binary bytes.
  const identities = ['hawdb.node', 'artifact.json', 'THIRD-PARTY-NOTICES.txt'].map(name => { try { return nativeFileIdentity(join(base, name)); } catch { return null; } });
  const selection = JSON.stringify([binary, binaryDigest ?? createHash('sha256').update(manifest).digest('hex'), sourceInstallation && runtime.env.CONCORD_NATIVE_TEST_HOOKS === '1', identities]);
  const rejection = rejected.get(selection);
  if (!revalidate && rejection !== undefined && performance.now() < rejection.retryAt) throw rejection.error;
  try {
    const artifact = verifiedArtifact(runtime);
    const prior = loaded.get(artifact.key);
    if (prior) { rejected.delete(selection); return prior; }
    const require = createRequire(import.meta.url);
    // Node caches require by path; our verified identity additionally owns bytes.
    delete require.cache[artifact.binary];
    const native = require(artifact.binary) as NativeModule;
    readIdentity(native.nativeIdentity());
    loaded.set(artifact.key, native);
    rejected.delete(selection);
    return native;
  } catch (cause) {
    const error = asFailure(cause);
    rejected.set(selection, { error, retryAt: performance.now() + 1000 });
    throw error;
  }
}
function verifiedArtifact(runtime: RuntimeEnvironmentSnapshot): { readonly binary: string; readonly key: string } {
  const target = hawdbTarget();
  if (sourceInstallation) verifySourceNativeArtifact(runtime);
  const base = join(nativeArtifactRoot(runtime), target);
  const metadata = decodeNativeArtifact(JSON.parse(readFileSync(join(base, 'artifact.json'), 'utf8')));
  if (!sourceInstallation && metadata.testHooks) throw new HawdbFailure('HawdbIncompatible', 'test-hook native artifact cannot be installed');
  if (metadata.target !== target || metadata.sourceDigest.length !== 64 || metadata.cargoLockDigest.length !== 64 || metadata.binarySha256.length !== 64 || metadata.noticesSha256.length !== 64) {
    throw new HawdbFailure('HawdbIncompatible', 'native artifact identity is incomplete');
  }
  if (target === 'darwin-arm64' && metadata.deploymentTarget !== HAWDB_MACOS_DEPLOYMENT_TARGET) {
    throw new HawdbFailure('HawdbIncompatible', 'macOS deployment target differs');
  }
  const noticesDigest = nativeFileDigest(join(base, 'THIRD-PARTY-NOTICES.txt'));
  if (noticesDigest !== metadata.noticesSha256) throw new HawdbFailure('HawdbIncompatible', 'native notices digest differs');
  const binary = realpathSync(join(base, 'hawdb.node'));
  const digest = nativeFileDigest(binary);
  if (digest !== metadata.binarySha256) throw new HawdbFailure('HawdbIncompatible', `native binary digest differs: ${binary}; expected ${metadata.binarySha256} from ${join(base, 'artifact.json')}; actual ${digest}. Reinstall a verified Concord package; cache clear cannot repair installation artifacts.`);
  return { binary, key: JSON.stringify([binary, digest, metadata.testHooks ?? false]) };
}
/** Revalidate the installation even when an already loaded binding remains usable. */
export function validateHawdbArtifact(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): void { boundary(() => { load(runtime, true); }); }
/** A remote client verifies installation bytes without loading an engine it does not own. */
export function verifyHawdbArtifact(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): void { boundary(() => { verifiedArtifact(runtime); }); }
class Database implements HawdbDatabase {
  private readonly native: NativeBridge;
  private closing: Promise<void> | undefined;
  constructor(native: NativeBridge) { this.native = native; }
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
  reclaim(): HawdbReclamation {
    return boundary(() => Schema.decodeUnknownSync(Schema.Struct({ reclaimedObjects: Schema.Int, reclaimedBytes: Schema.Int, deferredForActiveLeases: Schema.Boolean }), { onExcessProperty: 'error' })(this.native.reclaim()));
  }
  close(): void { boundary(() => this.native.close()); }
  closeAsync(): Promise<void> {
    if (this.closing) return this.closing;
    try { this.closing = this.native.closeAsync().catch(cause => { throw asFailure(cause); }); }
    catch (cause) { this.closing = Promise.reject(asFailure(cause)); }
    return this.closing;
  }
}
export function openHawdb(path: string, options: { readonly readOnly: boolean; readonly create: boolean }, runtime: RuntimeEnvironmentSnapshot = defaultRuntime): HawdbDatabase {
  return boundary(() => { const mode = decodeOptions(options); return new Database(new (load(runtime).CacheBridge)(decodePath(path), mode.readOnly, mode.create)); });
}
/** Service owners await native work without blocking their socket event loop. */
export async function openHawdbAsync(path: string, options: { readonly readOnly: boolean; readonly create: boolean }, runtime: RuntimeEnvironmentSnapshot = defaultRuntime): Promise<HawdbDatabase> {
  try {
    const mode = decodeOptions(options), native = load(runtime);
    // Missing lifecycle APIs are installation failures, never permission to
    // clear an otherwise compatible database or fall back to a blocking open.
    if (typeof native.openCache !== 'function') throw new HawdbFailure('HawdbUnavailable', 'Native artifact does not support asynchronous cache ownership');
    return new Database(await native.openCache(decodePath(path), mode.readOnly, mode.create));
  } catch (cause) { throw asFailure(cause); }
}
export function createMemoryHawdb(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): HawdbDatabase { return boundary(() => new Database(load(runtime).CacheBridge.memory())); }
export function acquireHawdbClearGuard(path: string, runtime: RuntimeEnvironmentSnapshot = defaultRuntime): { verify(): void; close(): void } {
  return boundary(() => {
    const guard = new (load(runtime).OwnerGuard)(decodePath(path));
    return { verify: () => boundary(() => guard.verify()), close: () => boundary(() => guard.close()) };
  });
}
export function hawdbIdentity(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): { readonly engine: 'hawdb'; readonly revision: string; readonly abi: string; readonly target: string } {
  return boundary(() => { load(runtime); return { engine: 'hawdb', revision: HAWDB_REVISION, abi: HAWDB_ABI, target: hawdbTarget() }; });
}
