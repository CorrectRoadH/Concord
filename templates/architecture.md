# {{title}}

Describe how this feature is implemented. Behavior belongs in the README, Use Case, CLI, and library pages; refactors that keep behavior change only this page.

## Entity Ownership

Define which entities contain or reference each other, how they are identified, and which owner creates and destroys them. Give exact shapes for public configuration and results.

## Data Flow

Trace input to output through each responsible module and name every intermediate product that crosses an ownership boundary.

Use Mermaid for relationships and flows. When motion or adjustable parameters explain the model better, add a `p5` fence and a prose explanation. External sketch and CSS paths are relative to this Markdown page; extension libraries belong in project `p5.libraries`. See `concord --skill view` for complete examples.

## Invariants

List the properties every implementation must preserve.

## Resource Lifecycle

When the feature holds resources or state, describe in order how each owner acquires and validates them, runs, and reuses or revalidates them. Describe cleanup after normal and interrupted runs. State what invalidates reuse and the observable result of cleanup failure.

## Errors

Assign each failure (acquisition, execution, cancellation, cleanup) to its stage and owner. Define the observable terminal result, and do not let one failure hide another.

## Identity and Reuse

State which declarations and results contribute to identity, when reuse is valid, and what invalidates it.
