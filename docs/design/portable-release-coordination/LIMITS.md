# Portable runtime and release coordination

## L1: Existing lock and recovery evidence remains valid

The release may not silently reinterpret current flock files, journals, leases or stale-lock recovery. A protocol migration requires its own stop-the-world migration and recovery proof.

## L2: Unsupported storage remains rejected

Darwin support is limited to verified local APFS with exact path identity. Windows, HFS, network filesystems and ambiguous aliases remain named failures.

## L3: Cleanup uncertainty cannot become success

Only an observed absent owned process group permits successful cleanup evidence. Termination waits are bounded and unknown observations remain failures.

## L4: Publication follows verification

Formal release/channel updates occur after their required identity and install checks. Existing tags/assets are never overwritten with different bytes, and build jobs do not receive unrelated write authority.
