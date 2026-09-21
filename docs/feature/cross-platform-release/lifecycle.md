# Cross-platform tagged releases

## Owners

Concord owns source validation, package bytes and source Release. The tap owns package-manager metadata and installation verification. Runtime scopes own flock descriptors and detached POSIX process groups.

## Create

Validate the source tag and package version, acquire ordinary repository coordination, build one tgz, then hand its immutable artifact identity to platform jobs. The tap accepts only the fixed public repository, canonical tag and unique matching asset.

## Run

Linux platform jobs install the same tgz in isolated Git consumers and execute the full check plus `init` and `check`. macOS 14/15 jobs only install source dependencies, build and create a package; they do not run the test suite. Homebrew later supplies `ripgrep` and the keg-only `util-linux` flock. After source publication, tap sync prepares and tests Formula/Nix before updating its branch and recipe tag.

## Reuse

Successful immutable artifacts may be reused by retry jobs. A changed commit, version, asset digest or generated dependency hash invalidates reuse.

## Cleanup

Repository leases retain existing finalizers. Owned processes receive TERM, a bounded grace period and KILL; failure to observe group disappearance is cleanup failure. CI temporary consumers and candidate taps are runner-local and removed after each job.

## Failure Ownership

Runtime cleanup failure overrides command success for evidence. Source matrix failure prevents source Release. Tap validation failure leaves the source Release installable as a raw package but does not update Homebrew/Nix availability.
