# Limits

## L1: Preserve authorization

Validate all planning reads, missing observations, directory membership, configuration and target preimages under publication ownership. Keep path and unknown-edit guards.

## L2: Recover safely

Recover only provably dead same-host owners. Concurrent recovery must not delete a new owner. Preserve unknown state and partial journals.

## L3: Preserve execution evidence

Retain before/after candidate and evidence checks, separate command resource ownership, and fail closed on cleanup uncertainty.

## L4: No new fact store

SQLite is only a disposable cache. Do not add a database coordination owner, old-version migration or compatibility mode.
