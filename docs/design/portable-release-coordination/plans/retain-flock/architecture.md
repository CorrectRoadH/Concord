# Portable runtime and release coordination

## Entity Ownership

LocalRepository owns the generic lock and journal; coordination owns the Trace flock descriptor. Homebrew owns the runtime dependency path, while Concord remains unaware of package-manager layout. Source and tap releases own separate tag-to-commit identities.

## Data Flow

Platform admission validates host, local filesystem and exact path identity before acquiring the unchanged flock lease. Commands then use existing journals and finalizers. Release CI packs once, distributes the artifact to install jobs, and publishes only after their results. Tap sync consumes the public immutable asset.

## Invariants

Lock descriptors remain the exclusion authority; lock-file presence alone is not ownership. Recovery rules and journal bytes retain their meanings. APFS aliases cannot name a second owner. Package digest and version are checked at every repository boundary.

## Errors

Missing flock is CoordinationFailed; unsupported platform/storage is a named storage failure; process uncertainty is cleanup failure. CI identity or install failures stop publication at the owning repository.

## Identity and Reuse

Existing repository project/root/privateDir identities stay unchanged. Release reuse requires exact tag commit, version and tgz digest; recipe reuse also requires generated hashes and recipe commit.
