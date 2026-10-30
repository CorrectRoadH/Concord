import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { packageRoot as root } from "./location.js";
import { decodeNativeArtifact, hawdbTarget } from "./hawdb-native-contract.js";

export const nativeSourceFiles = ['native/hawdb/Cargo.toml', 'native/hawdb/build.rs', 'native/hawdb/rust-toolchain.toml', 'native/hawdb/src/lib.rs', 'native/hawdb/UPSTREAM.txt', 'native/hawdb/HAWDB-LICENSE.txt', 'src/base/cache/hawdb-native.ts', 'src/base/installation/hawdb-native-contract.ts', 'scripts/build-native.ts'] as const;
const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
export const nativeSourceDigest = (): string => hash(nativeSourceFiles.map(path => `${path}\0${hash(readFileSync(join(root, path)))}\n`).join(''));
export const nativeLockDigest = (): string => hash(readFileSync(join(root, 'native/hawdb/Cargo.lock')));
export const nativeCacheRoot = (): string => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/native', `${nativeSourceDigest()}-${nativeLockDigest()}`);
export const nativeArtifactRoot = import.meta.url.endsWith('.ts') ? nativeCacheRoot() : join(root, 'dist/native');

/** Source runs require the exact pinned bridge, lock, binary and notices. */
export function verifySourceNativeArtifact(): void {
  const folder = join(nativeArtifactRoot, hawdbTarget());
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(folder, 'artifact.json'), 'utf8')));
  if (artifact.target !== hawdbTarget() || artifact.sourceDigest !== nativeSourceDigest() || artifact.cargoLockDigest !== nativeLockDigest()
    || artifact.binarySha256 !== hash(readFileSync(join(folder, 'hawdb.node')))
    || artifact.noticesSha256 !== hash(readFileSync(join(folder, 'THIRD-PARTY-NOTICES.txt'))) || artifact.testHooks) {
    throw new Error('HawdbIncompatible: source native artifact identity differs');
  }
}
