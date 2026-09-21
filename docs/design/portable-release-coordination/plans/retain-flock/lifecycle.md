# Portable runtime and release coordination

## Owners

The runtime owns platform admission, flock scopes and process groups. Concord CI owns package bytes. The tap owns package-manager recipes.

## Create

Validate exact local paths and filesystem, locate flock from PATH, acquire the descriptor lease, then inspect journals. CI validates canonical tag/version before producing an artifact.

## Run

Repository operations retain the current lease/journal sequence. Process execution creates one detached POSIX group and observes cleanup within a bounded budget. Release jobs install one artifact; tap jobs install the candidate recipe.

## Reuse

No repository lock state is reused across operations. Immutable package artifacts may be reused only with the same digest and tag identity.

## Cleanup

Scopes close descriptors after command completion. TERM/grace/KILL observation is bounded; unknown group state fails cleanup. Runner-local candidates are disposable. Published identities are resumed, never overwritten.

## Failure Ownership

Coordination owns missing/busy flock diagnostics; storage owns host/filesystem/path failures; OwnedProcess owns termination evidence; each repository's workflow owns its publication failure.
