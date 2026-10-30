# {{title}}

Before writing, read `docs/constitution.md` and link each applicable clause or paragraph ID next to the sentence that relies on it.

Declare intended behavior, constraints, and acceptance. Keep development logs, investigation history, and implementation progress in Concord Memory; product workflows belong in the contract.

## Problem

Describe the user problem and why the product needs a current contract for it.

## Core Mental Model

Define the concepts users must understand and identify who owns each declaration.
Link to shared terms in `concepts.md#id`, or define local terms in this directory's
`concepts.md`. Explain each term under its own heading there.

Use Mermaid for structural diagrams and optional `p5` Markdown fences for animation or interaction. Keep the conclusion readable without running a sketch. Read `concord --skill view` for examples; declare extension libraries in project configuration, never in Markdown.

## Scope

State what the feature includes and excludes.

## Entry Points

{{entryPoints}}
