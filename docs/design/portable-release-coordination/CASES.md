# Portable runtime and release coordination

Define the same user problems, fixed inputs, and acceptance results for every candidate. Use solution-neutral terms and stable case IDs.

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | Run existing projects concurrently on Linux. | Current flock/journal state and shared/exclusive semantics. | Existing contention, recovery and unknown-edit tests keep their meaning. |
| C2 | Initialize on a supported Mac. | Apple Silicon macOS 14/15, local APFS, Homebrew Node/Git/flock. | Packed CLI completes init/check; aliases and non-APFS paths are rejected. |
| C3 | Stop a resistant child tree. | Detached POSIX group, bounded TERM/KILL budget. | Group absence is observed or cleanup fails without green evidence or hanging. |
| C4 | Publish from a tag. | Canonical tag equals package version; one tgz. | All OS jobs install the same digest before the Release becomes public. |
| C5 | Synchronize the tap twice. | Same release identity on both runs. | Second run is a no-op; different bytes or older version are rejected. |
