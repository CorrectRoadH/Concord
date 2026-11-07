import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { packageRoot as root } from "./location.ts";
import { decodeNativeArtifact, hawdbTarget } from "./hawdb-native-contract.ts";
import { sourceInstallation } from './runtime.ts';
import { readNativeRelease, nativeReleaseAsset } from './native-release.ts';
import { makeRuntimeEnvironment, runtimeCacheHome, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';

const defaultRuntime = makeRuntimeEnvironment(root, {});

export const nativeSourceFiles = ['native-release.json'] as const;
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
export const nativeCacheRoot = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime, testHooks = runtime.env.CONCORD_NATIVE_TEST_HOOKS === '1'): string => join(runtimeCacheHome(runtime), 'concord/native', readNativeRelease().tag, ...(testHooks ? ['test-hooks'] : []));
export const nativeArtifactRoot = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string => sourceInstallation ? nativeCacheRoot(runtime) : join(root, 'dist/native');

/** Source runs require the exact pinned bridge, lock, binary and notices. */
export function verifySourceNativeArtifact(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): void {
  const folder = join(nativeArtifactRoot(runtime), hawdbTarget());
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(folder, 'artifact.json'), 'utf8')));
  const release = readNativeRelease(), hooks = runtime.env.CONCORD_NATIVE_TEST_HOOKS === '1';
  const expected = nativeReleaseAsset(release, hawdbTarget(), hooks);
  if (artifact.target !== hawdbTarget() || artifact.sourceDigest !== release.sourceDigest || artifact.cargoLockDigest !== release.cargoLockDigest
    || artifact.binarySha256 !== expected.binarySha256 || artifact.noticesSha256 !== expected.noticesSha256
    || artifact.binarySha256 !== nativeFileDigest(join(folder, 'hawdb.node'))
    || artifact.noticesSha256 !== nativeFileDigest(join(folder, 'THIRD-PARTY-NOTICES.txt'))
    || artifact.testHooks !== hooks) {
    throw new Error('HawdbIncompatible: source native artifact identity differs');
  }
}
