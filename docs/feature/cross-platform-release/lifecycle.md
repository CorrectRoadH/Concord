# Cross-platform tagged releases

## Owners

Concord owns source validation, package bytes and source Release. The tap owns package-manager metadata and installation verification. Short runtime scopes own publication file leases; runner scopes separately own detached POSIX process groups and persistent cleanup state.

## Create

Validate the source tag and package version, acquire ordinary repository coordination, build one tgz, then hand its immutable artifact identity to platform jobs. The tap accepts only the fixed public repository, canonical tag and unique matching asset.

## Run

One Ubuntu 24.04 job builds and typechecks, creates the single npm tgz containing both target-native engines, verifies its digest, and installs that exact asset in an isolated Git consumer for `init` and `check`. Four Ubuntu shards execute the complete test suite from this packed build, in parallel with macOS 14/15 verification. Publication requires every shard and platform to succeed. npm owns target-specific optional dependency selection at installation. Homebrew supplies the runtime and `ripgrep`; no external lock helper is required. After source publication, tap sync prepares and validates Formula/Nix before updating its branch and recipe tag.

## Reuse

Successful immutable artifacts may be reused by retry jobs. A changed commit, version, asset digest or generated dependency hash invalidates reuse.

Cargo caches are scoped by runner image, native target, deployment target, Rust toolchain, lockfile and native build sources. Default-branch checks seed both platforms. A cache hit still runs the locked build and native recovery tests; cached compilation is not test evidence. Ordinary Check runs on branches and pull requests; release tags use the complete Release validation graph.

## Cleanup

Repository leases retain existing finalizers. Owned processes receive TERM, a bounded grace period and KILL; failure to observe group disappearance is cleanup failure. CI temporary consumers and candidate taps are runner-local and removed after each job.

## Failure Ownership

Runtime cleanup failure overrides command success for evidence. Source matrix failure prevents source Release. Tap validation failure leaves the source Release installable as a raw package but does not update Homebrew/Nix availability.
