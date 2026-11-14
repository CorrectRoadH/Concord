import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { NativeArtifactInvalid, HAWDB_REVISION, HAWDB_VERSION, HAWDB_TARGETS, NativeDigest, type HawdbTarget } from './hawdb-native-contract.ts';
import { packageRoot } from './location.ts';

const Version = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u));
const Asset = Schema.Struct({
  target: Schema.Literals(HAWDB_TARGETS), upstreamTarget: Schema.Literals(['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu']), name: Schema.String,
  archiveSha256: NativeDigest, manifestSha256: NativeDigest, binarySha256: NativeDigest, headerSha256: NativeDigest, licenseSha256: NativeDigest,
});
export const NativeReleaseSchema = Schema.Struct({
  format: Schema.Literal('concord.native-release/v2'), repository: Schema.Literal('nowledge-co/hawdb'),
  version: Version, tag: Schema.String, revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}(?![\s\S])/u)), assets: Schema.Array(Asset),
});
export type NativeRelease = typeof NativeReleaseSchema.Type;
export function decodeNativeRelease(value: unknown): NativeRelease {
  const release = Schema.decodeUnknownSync(NativeReleaseSchema, { onExcessProperty: 'error' })(value);
  if (release.revision !== HAWDB_REVISION || release.version !== HAWDB_VERSION || release.tag !== `v${release.version}` || release.assets.length !== 2) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: invalid native release version or assets' });
  for (const target of HAWDB_TARGETS) {
    const assets = release.assets.filter(asset => asset.target === target);
    const upstream = target === 'darwin-arm64' ? 'aarch64-apple-darwin' : 'x86_64-unknown-linux-gnu';
    if (assets.length !== 1 || assets[0]!.upstreamTarget !== upstream || assets[0]!.name !== `hawdb-ffi-${release.version}-${upstream}.tar.gz`) throw new NativeArtifactInvalid({ message: 'HawdbIncompatible: invalid native release target' });
  }
  return release;
}
export const readNativeRelease = (checkout = packageRoot): NativeRelease => decodeNativeRelease(JSON.parse(readFileSync(join(checkout, 'native-release.json'), 'utf8')));
export const nativeReleaseAsset = (release: NativeRelease, target: HawdbTarget): NativeRelease['assets'][number] => release.assets.find(asset => asset.target === target)!;
