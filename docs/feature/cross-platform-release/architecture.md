# Cross-platform tagged releases

## Entity Ownership

The source tag and package metadata are owned by CorrectRoadH/Concord. Its GitHub Release owns the tgz. CorrectRoadH/homebrew-tap owns Formula, Nix expressions and the recipe tag. Runtime coordination remains owned by the existing descriptor-backed `flock` protocol; this release does not migrate lock or journal formats.

## Data Flow

The tag workflow validates tag/version, runs checks, packs once, installs that artifact on the supported matrix, then publishes the source Release. The tap periodically or manually discovers a newer public release, verifies tag/package/asset identity, computes hashes, prepares Formula/Nix, validates the candidate checkout, and only then commits and tags the recipe.

## Invariants

- Linux filesystem allowlisting and existing lock/recovery semantics do not change.
- Darwin accepts only verified APFS paths with exact component spelling; aliases cannot create a second owner identity.
- Only ESRCH proves an owned POSIX process group is gone. Cleanup uncertainty cannot produce green evidence.
- Release jobs install the exact candidate tgz; tap tests resolve the candidate recipe, not an older remote tap.
- Versions never move backward and an existing identity cannot be overwritten with different bytes.

## Errors

Unsupported hosts/filesystems, missing `flock`, unsafe aliases and cleanup uncertainty remain named runtime failures. Source publication failures belong to the source workflow; Formula/Nix failures belong to the tap sync. Neither failure is converted into a successful release claim.

## Identity and Reuse

Version, source tag commit, package metadata, tgz SHA-256 and recipe commit form the release mapping. A rerun may continue an interrupted stage only when those identities match exactly.
