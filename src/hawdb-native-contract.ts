import { Schema } from 'effect';

export const HAWDB_REVISION = '1e9f76428be6649a18a6f99d75b0ccfef16bf545';
export const HAWDB_ABI = 'concord-hawdb-1';
export const HAWDB_TARGETS = ['linux-x64-glibc', 'darwin-arm64'] as const;
export type HawdbTarget = typeof HAWDB_TARGETS[number];

export const NativeArtifactSchema = Schema.Struct({
  target: Schema.Literals(HAWDB_TARGETS),
  abi: Schema.Literal(HAWDB_ABI),
  revision: Schema.Literal(HAWDB_REVISION),
  sourceDigest: Schema.String,
  cargoLockDigest: Schema.String,
  binarySha256: Schema.String,
  noticesSha256: Schema.String,
  portable: Schema.Boolean,
  testHooks: Schema.optional(Schema.Boolean),
  deploymentTarget: Schema.optional(Schema.String),
});
export type NativeArtifact = Schema.Schema.Type<typeof NativeArtifactSchema>;
export const decodeNativeArtifact = Schema.decodeUnknownSync(NativeArtifactSchema, { onExcessProperty: 'error', errors: 'all' });

export function hawdbTarget(): HawdbTarget {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64-glibc';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  throw new Error(`HawdbUnavailable: unsupported target ${process.platform}-${process.arch}`);
}
