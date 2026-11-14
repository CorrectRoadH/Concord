import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { packageRoot as root } from "./location.ts";
import { NativeArtifactInvalid, decodeNativeArtifact, decodeOfficialHawdbManifest, hawdbLibraryName, hawdbTarget, type HawdbTarget } from "./hawdb-native-contract.ts";
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
  if (!stat.isFile()) throw new NativeArtifactInvalid({ message: `HawdbIncompatible: native input is not a regular file: ${path}` });
  return `${realpathSync(path)}:${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
export function nativeFileDigest(path: string): string {
  const identity = nativeFileIdentity(path), prior = fileDigests.get(path);
  if (prior?.identity === identity) return prior.digest;
  const digest = hash(readFileSync(path));
  if (nativeFileIdentity(path) !== identity) throw new NativeArtifactInvalid({ message: `HawdbIncompatible: native input changed while hashing: ${path}` });
  if (fileDigests.size >= 256) fileDigests.delete(fileDigests.keys().next().value!);
  fileDigests.set(path, { identity, digest });
  return digest;
}
export const nativeCacheRoot = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string => join(runtimeCacheHome(runtime), 'concord/native', readNativeRelease().tag);
export const nativeArtifactRoot = (runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string => sourceInstallation ? nativeCacheRoot(runtime) : join(root, 'dist/native');

/** Preserve the upstream manifest as provenance while binding installed, relocated bytes. */
function verifyNativeArtifactDirectoryUnsafe(folder: string, target: HawdbTarget, original = true, release = readNativeRelease()) {
  const expected = nativeReleaseAsset(release, target);
  const binary = join(folder, hawdbLibraryName(target));
  const identity = nativeFileIdentity(binary);
  const files = ['LICENSE', 'include/hawdb_ffi.h', 'lib/libhawdb_ffi.a', hawdbLibraryName(target)].sort();
  const allowed = new Set(['artifact.json', 'manifest.json', ...files]);
  const visit = (directory: string, prefix = ''): void => {
    if (!lstatSync(directory).isDirectory()) throw new NativeArtifactInvalid({ message: `HawdbIncompatible: native directory is not regular: ${directory}` });
    for (const name of readdirSync(directory)) {
      const path = prefix + name, entry = lstatSync(join(directory, name));
      if (entry.isDirectory() && (path === 'include' || path === 'lib')) visit(join(directory, name), `${path}/`);
      else if (!entry.isFile() || !allowed.has(path)) throw new NativeArtifactInvalid({ message: `HawdbIncompatible: unknown or non-regular native member: ${path}` });
    }
  };
  visit(folder);
  const identities = new Map([...allowed].map(file => [join(folder, file), nativeFileIdentity(join(folder, file))]));
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(folder, 'artifact.json'), 'utf8')));
  const manifestPath = join(folder, 'manifest.json');
  if (artifact.target !== target || artifact.upstreamManifestSha256 !== expected.manifestSha256 || nativeFileDigest(manifestPath) !== expected.manifestSha256) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: official manifest digest differs' });
  const manifest = decodeOfficialHawdbManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (manifest.target !== expected.upstreamTarget || manifest.requirements.os !== (target === 'darwin-arm64' ? 'macos' : 'linux') || manifest.build.runner !== (target === 'darwin-arm64' ? 'macos-15' : 'ubuntu-24.04') || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(files)) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: official manifest target or members differ' });
  if (manifest.files[hawdbLibraryName(target)]!.sha256 !== expected.binarySha256 || manifest.files['include/hawdb_ffi.h']!.sha256 !== expected.headerSha256 || manifest.files.LICENSE!.sha256 !== expected.licenseSha256) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: official manifest identities differ from pin' });
  for (const file of files) {
    const path = join(folder, file), recorded = manifest.files[file]!;
    const relocated = !original && target === 'linux-x64-glibc' && file === hawdbLibraryName(target);
    if (nativeFileDigest(path) !== (relocated ? artifact.binarySha256 : recorded.sha256) || !relocated && statSync(path).size !== recorded.size) throw new NativeArtifactInvalid({ message: `HawdbIncompatible: native member bytes differ: ${file}` });
  }
  if ((original || target === 'darwin-arm64') && artifact.binarySha256 !== expected.binarySha256 || artifact.binarySha256 !== nativeFileDigest(binary)) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: native binary receipt differs' });
  if ([...identities].some(([path, recorded]) => nativeFileIdentity(path) !== recorded) || nativeFileIdentity(binary) !== identity) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: native library changed during verification' });
  return { binary: realpathSync(binary), identity, version: manifest.version };
}

export function verifyNativeArtifactDirectory(folder: string, target: HawdbTarget, original = true, release = readNativeRelease()): { binary: string; identity: string; version: string } {
  try { return verifyNativeArtifactDirectoryUnsafe(folder, target, original, release); }
  catch (cause) {
    if (cause instanceof NativeArtifactInvalid) throw cause;
    throw new NativeArtifactInvalid({ message: `HawdbIncompatible: cannot verify native artifact: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
}

export function verifiedHawdbLibrary(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): { binary: string; identity: string; version: string } {
  return verifyNativeArtifactDirectory(join(nativeArtifactRoot(runtime), hawdbTarget()), hawdbTarget(), sourceInstallation);
}
export function verifySourceNativeArtifact(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): void {
  verifiedHawdbLibrary(runtime);
}
