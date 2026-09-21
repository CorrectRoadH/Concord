# Portable runtime and release coordination

## Owners

List each owner's inputs, runtime obligations, and boundaries.

## Create

Describe resource acquisition in order, including validation and readiness before use.

## Run

Describe the complete execution sequence and which owner controls each transition.

## Reuse

State what can be reused, what must be reset or revalidated, and what invalidates reuse.

## Cleanup

Describe normal and interrupted cleanup, ordering, idempotency, and the observable result of cleanup failure.

## Failure Ownership

Assign acquisition, execution, cancellation, and cleanup failures to named owners without allowing one failure to hide another.
