import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { HAWDB_ABI, HAWDB_REVISION, HAWDB_TARGETS, type HawdbTarget } from './hawdb-native-contract.ts';
import { packageRoot } from './location.ts';

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u));
// Unlike $, the end boundary also rejects a final line terminator.
const EngineVersion = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u));
const ReleaseVersion = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-concord\.[1-9]\d*)?(?![\s\S])/u));
const Asset = Schema.Struct({
  target: Schema.Literals(HAWDB_TARGETS), testHooks: Schema.Boolean, name: Schema.String,
  archiveSha256: Digest, binarySha256: Digest, noticesSha256: Digest,
});
export const NativeReleaseSchema = Schema.Struct({
  format: Schema.Literal('concord.native-release/v1'), repository: Schema.Literal('CorrectRoadH/hawdb'),
  version: ReleaseVersion, tag: Schema.String, producerCommit: Commit, engineVersion: EngineVersion,
  revision: Commit, abi: Schema.Literal(HAWDB_ABI),
  sourceDigest: Digest, cargoLockDigest: Digest, assets: Schema.Array(Asset),
});
export type NativeRelease = Schema.Schema.Type<typeof NativeReleaseSchema>;
export function decodeNativeRelease(value: unknown): NativeRelease {
  const release = Schema.decodeUnknownSync(NativeReleaseSchema, { onExcessProperty: 'error' })(value);
  if (release.revision !== HAWDB_REVISION || release.version.split('-')[0] !== release.engineVersion || release.tag !== `hawdb-${release.version}` || release.assets.length !== 4) throw new Error('HawdbIncompatible: invalid native release version or assets');
  for (const target of HAWDB_TARGETS) for (const testHooks of [false, true]) {
    const assets = release.assets.filter(asset => asset.target === target && asset.testHooks === testHooks);
    if (assets.length !== 1 || assets[0]!.name !== `hawdb-${target}${testHooks ? '-test-hooks' : ''}.tar.gz`) throw new Error('HawdbIncompatible: invalid native release target/mode');
  }
  return release;
}
export const readNativeRelease = (checkout = packageRoot): NativeRelease => decodeNativeRelease(JSON.parse(readFileSync(join(checkout, 'native-release.json'), 'utf8')));
export const nativeReleaseAsset = (release: NativeRelease, target: HawdbTarget, testHooks: boolean): NativeRelease['assets'][number] => release.assets.find(asset => asset.target === target && asset.testHooks === testHooks)!;
