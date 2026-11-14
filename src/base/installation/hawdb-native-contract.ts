import { Schema } from 'effect';
import nativeRelease from '../../../native-release.json' with { type: 'json' };

export class NativeArtifactInvalid extends Schema.TaggedError<NativeArtifactInvalid>()('NativeArtifactInvalid', { message: Schema.String }) {}
export class NativeTargetUnsupported extends Schema.TaggedError<NativeTargetUnsupported>()('NativeTargetUnsupported', { message: Schema.String }) {}

export const HAWDB_VERSION = nativeRelease.version;
export const HAWDB_REVISION = nativeRelease.revision;
export const HAWDB_MACOS_DEPLOYMENT_TARGET = '11.0';
export const HAWDB_TARGETS = ['linux-x64-glibc', 'darwin-arm64'] as const;
export type HawdbTarget = typeof HAWDB_TARGETS[number];
export const NativeDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}(?![\s\S])/u));
export const NativeArtifactSchema = Schema.Struct({
  format: Schema.Literal('concord.native-artifact/v2'),
  target: Schema.Literals(HAWDB_TARGETS),
  upstreamManifestSha256: NativeDigest,
  binarySha256: NativeDigest,
});
export type NativeArtifact = typeof NativeArtifactSchema.Type;
export const decodeNativeArtifact = Schema.decodeUnknownSync(NativeArtifactSchema, { onExcessProperty: 'error', errors: 'all' });

export function hawdbTarget(): HawdbTarget {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64-glibc';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  throw new NativeTargetUnsupported({ message: `HawdbUnavailable: unsupported target ${process.platform}-${process.arch}` });
}
export const hawdbLibraryName = (target: HawdbTarget): string => `lib/libhawdb_ffi.${target === 'darwin-arm64' ? 'dylib' : 'so'}`;

const FileIdentity = Schema.Struct({ sha256: NativeDigest, size: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)) });
const Requirements = Schema.Union([
  Schema.Struct({ os: Schema.Literal('linux'), libc: Schema.Literal('glibc'), min_glibc: Schema.Literal('2.34'), static_link_flags: Schema.Tuple([Schema.Literal('-lgcc_s'), Schema.Literal('-lm'), Schema.Literal('-lc')]) }),
  Schema.Struct({ os: Schema.Literal('macos'), min_os_version: Schema.Literal('11.0'), install_name: Schema.Literal('@rpath/libhawdb_ffi.dylib'), code_signature: Schema.Literal("ad-hoc; sign with your application's identity when embedding"), static_link_flags: Schema.Tuple([Schema.Literal('-framework'), Schema.Literal('IOKit'), Schema.Literal('-framework'), Schema.Literal('CoreFoundation'), Schema.Literal('-liconv'), Schema.Literal('-lc++')]) }),
]);
export const OfficialHawdbManifest = Schema.Struct({
  name: Schema.Literal('hawdb-ffi'), version: Schema.Literal(HAWDB_VERSION), engine_revision: Schema.Literal(HAWDB_REVISION),
  target: Schema.Literals(['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu']),
  abi: Schema.Struct({ header: Schema.Literal('include/hawdb_ffi.h'), library_version: Schema.Literal(`hawdb ${HAWDB_VERSION}`), retained_abi_version: Schema.Literal(1), compatibility: Schema.Literal('Pre-1.0: the ordinary C ABI is versioned with the HawDB release and may change between minor versions. Compile against the header shipped in the same archive and load only that library; hawdb_version() reports the engine version. The hawdb_retained_* exports are experimental.') }),
  build: Schema.Struct({ configuration: Schema.Literal('--config=prebuilt'), runner: Schema.Literals(['macos-15', 'ubuntu-24.04']), system: Schema.Literal('bazel'), targets: Schema.Tuple([Schema.Literal('//bindings/ffi:hawdb_ffi'), Schema.Literal('//bindings/ffi:hawdb_ffi_static')]) }),
  feature_profile: Schema.Struct({ name: Schema.Literal('default'), features: Schema.Tuple([Schema.Literal('background-maintenance'), Schema.Literal('full-text-search'), Schema.Literal('graph-analytics'), Schema.Literal('tokio-runtime'), Schema.Literal('vector-search')]) }),
  files: Schema.Record(Schema.String, FileIdentity), requirements: Requirements,
});
export type OfficialHawdbManifest = typeof OfficialHawdbManifest.Type;
export const decodeOfficialHawdbManifest = Schema.decodeUnknownSync(OfficialHawdbManifest, { onExcessProperty: 'error', errors: 'all' });
