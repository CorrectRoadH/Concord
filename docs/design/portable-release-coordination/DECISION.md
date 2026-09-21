# Portable runtime and release coordination

## Decision

Selected: [retain-flock](plans/retain-flock/README.md)

## Rationale

The existing descriptor-backed flock protocol already supplies shared/exclusive coordination around generic and Trace state. Homebrew's supported `util-linux` formula provides flock on Apple Silicon macOS, so the runtime can add Darwin/APFS checks without changing lock identity, stale-owner deletion or journal recovery. This directly preserves G1 and avoids a second protocol generation.

One packed artifact and platform jobs satisfy G2. Source Release ownership plus a public tap synchronization workflow gives each repository authority over its own state and satisfies G3 while avoiding a cross-repository write token; scheduled tap discovery is asynchronous and the manual dispatch is the immediate recovery path.

## Rejected Options

`portable-lock` would remove the external helper, but a persistent filesystem lock changes concurrent read behavior and creates new crash windows. It also cannot safely replace an already-open flock inode without a coordinated offline migration. That cost and risk are unrelated to delivering macOS support.

## Residual Risks

GitHub scheduled workflows can be delayed or disabled after inactivity; workflow_dispatch remains the explicit recovery entry. Intel macOS and HFS are unverified and excluded. Homebrew `util-linux` is keg-only, so the Formula wrapper must inject its opt_bin and CI must prove the installed command resolves it. This design decision does not replace the macOS/Linux matrix or release-state tests.
