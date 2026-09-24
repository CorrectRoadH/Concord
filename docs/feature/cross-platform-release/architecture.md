# Cross-platform tagged releases

## Entity Ownership

The source tag and package metadata are owned by CorrectRoadH/Concord. Its GitHub Release owns the tgz. CorrectRoadH/homebrew-tap owns Formula, Nix expressions and the recipe tag. Runtime coordination follows [portable publication](../../design/portable-publication/README.md): one Node file lease for short snapshots and commits. HawDB remains disposable cache. Version 0.6.0 provides no old lock migration or mixed-version coordination.

## Data Flow

The tag workflow derives package metadata from the validated tag in CI, runs checks, packs once, installs that artifact on the supported matrix, tests the same packed build on Apple Silicon macOS 14/15, then publishes the source Release. The tap periodically or manually discovers a newer public release, verifies tag/package/asset identity, computes hashes, prepares Formula/Nix, validates the candidate checkout, and only then commits and tags the recipe.

## Invariants

- Ordinary runtime does not probe filesystem names or invoke external lock/disk helpers; supported coordination is local to one host and PID namespace.
- Darwin preserves exact component spelling; aliases cannot create a second owner identity.
- Only ESRCH proves an owned POSIX process group is gone. Cleanup uncertainty cannot produce green evidence.
- Release jobs install the exact candidate tgz; tap tests resolve the candidate recipe, not an older remote tap.
- Versions never move backward and an existing identity cannot be overwritten with different bytes.

## Errors

Unsupported hosts, unavailable filesystem primitives, unsafe aliases and cleanup uncertainty remain named runtime failures. Source publication failures belong to the source workflow; Formula/Nix failures belong to the tap sync. Neither failure is converted into a successful release claim.

## Identity and Reuse

Version, source tag commit, package metadata, tgz SHA-256 and recipe commit form the release mapping. A rerun may continue an interrupted stage only when those identities match exactly.

Native engines are built on their target systems before packaging. The packaging job cleans dist before collecting the complete verified native set, then packs once. Later validation extracts that exact artifact without rebuilding or deleting another target. Portable checks must assert an actual HawDB cache miss followed by hit; source fallback alone is insufficient.
