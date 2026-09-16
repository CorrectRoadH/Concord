import { Schema } from "effect"

export const PackageSourceSchema = Schema.Struct({
  path: Schema.String,
  commit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  digest: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u))
})

export const PackageClassificationSchema = Schema.Struct({
  kind: Schema.Literals(["engineering-owner", "roadmap-owner", "design-owner", "design-plan-relocation", "research-owner", "research-supporting"]),
  sourcePath: Schema.String,
  targetPath: Schema.String,
  ownerBefore: Schema.String,
  ownerAfter: Schema.String,
  evidence: Schema.Array(Schema.String)
})

export const PackageChangeSchema = Schema.Struct({
  path: Schema.String,
  beforeDigest: Schema.NullOr(Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u))),
  after: Schema.NullOr(Schema.String),
  encoding: Schema.Literals(["utf8", "base64"])
})

export const PackageInputSchema = Schema.Struct({
  path: Schema.String,
  digest: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)),
  role: Schema.Literals(["document", "configuration", "history-excluded"])
})

export const DocumentPackageMigrationPlanSchema = Schema.Struct({
  format: Schema.Literal("concord.document-package-migration/v1"),
  plannerVersion: Schema.Literal("document-packages-1"),
  root: Schema.String,
  head: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  config: Schema.Struct({ path: Schema.String, digest: Schema.String, source: Schema.String }),
  generatedAt: Schema.String,
  inputs: Schema.Array(PackageInputSchema),
  classifications: Schema.Array(PackageClassificationSchema),
  changes: Schema.Array(PackageChangeSchema),
  outputs: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })),
  audit: Schema.Struct({
    ownerMap: Schema.Array(Schema.Struct({ before: Schema.String, after: Schema.String, sourceDigest: Schema.String })),
    linkMap: Schema.Array(Schema.Struct({ source: Schema.String, oldTarget: Schema.String, newTarget: Schema.String })),
    typedRefs: Schema.Array(Schema.Struct({ source: Schema.String, field: Schema.String, oldTarget: Schema.String, newTarget: Schema.String })),
    excludedHistory: Schema.Array(Schema.String),
    preservedAssets: Schema.Array(Schema.String)
  })
})

export type DocumentPackageMigrationPlan = typeof DocumentPackageMigrationPlanSchema.Type
export type PackageChange = typeof PackageChangeSchema.Type
export type PackageClassification = typeof PackageClassificationSchema.Type
