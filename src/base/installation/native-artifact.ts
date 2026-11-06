import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { packageRoot as root } from "./location.ts";
import { decodeNativeArtifact, hawdbTarget } from "./hawdb-native-contract.ts";
import { sourceInstallation } from './runtime.ts';
import { makeRuntimeEnvironment, runtimeCacheHome, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';

const defaultRuntime = makeRuntimeEnvironment(root, {});

export const nativeSourceFiles = ['native/hawdb/Cargo.toml', 'native/hawdb/build.rs', 'native/hawdb/rust-toolchain.toml', 'native/hawdb/src/lib.rs', 'native/hawdb/UPSTREAM.txt', 'native/hawdb/HAWDB-LICENSE.txt', 'src/base/cache/hawdb-native.ts', 'src/base/installation/hawdb-native-contract.ts', 'scripts/build-native.ts'] as const;
const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const fileDigests = new Map<string, { readonly identity: string; readonly digest: string }>();
/** Reuse byte evidence only while the same file remains unchanged. No environment is cached. */
export function nativeFileIdentity(path: string): string {
  const stat = statSync(path, { bigint: true });
  if (!stat.isFile()) throw new Error(`HawdbIncompatible: native input is not a regular file: ${path}`);
  return `${realpathSync(path)}:${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
export function nativeFileDigest(path: string): string {
  const identity = nativeFileIdentity(path), prior = fileDigests.get(path);
  if (prior?.identity === identity) return prior.digest;
  const digest = hash(readFileSync(path));
  if (nativeFileIdentity(path) !== identity) throw new Error(`HawdbIncompatible: native input changed while hashing: ${path}`);
  if (fileDigests.size >= 256) fileDigests.delete(fileDigests.keys().next().value!);
  fileDigests.set(path, { identity, digest });
  return digest;
}
export const nativeSourceDigest = (): string => hash(nativeSourceFiles.map(path => `${path}\0${nativeFileDigest(join(root, path))}\n`).join(''));
export const nativeLockDigest = (): string => nativeFileDigest(join(root, 'native/hawdb/Cargo.lock'));
export const nativeCacheRoot = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string => join(runtimeCacheHome(runtime), 'concord/native', `${nativeSourceDigest()}-${nativeLockDigest()}`);
export const nativeArtifactRoot = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string => sourceInstallation ? nativeCacheRoot(runtime) : join(root, 'dist/native');

/** Source runs require the exact pinned bridge, lock, binary and notices. */
export function verifySourceNativeArtifact(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): void {
  const folder = join(nativeArtifactRoot(runtime), hawdbTarget());
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(folder, 'artifact.json'), 'utf8')));
  if (artifact.target !== hawdbTarget() || artifact.sourceDigest !== nativeSourceDigest() || artifact.cargoLockDigest !== nativeLockDigest()
    || artifact.binarySha256 !== nativeFileDigest(join(folder, 'hawdb.node'))
    || artifact.noticesSha256 !== nativeFileDigest(join(folder, 'THIRD-PARTY-NOTICES.txt'))
    || (artifact.testHooks ?? false) !== (runtime.env.CONCORD_NATIVE_TEST_HOOKS === '1')) {
    throw new Error('HawdbIncompatible: source native artifact identity differs');
  }
}
