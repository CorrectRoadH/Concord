# Your title

Before writing, read `docs/constitution.md` and link each applicable clause or paragraph ID next to the sentence that relies on it.

Write this page for a reader who has never used the feature. Declare intended behavior, constraints, and acceptance. Keep development logs, investigation history, and implementation progress in Concord Memory; product workflows belong in the contract.

Open with two or three sentences: who uses the feature and what problem it solves for them.

## What You Can Do

List what a user can accomplish, one capability per item, in the user's language. Use only terms defined in `concepts.md`; define a new term there before using it here. Link to shared terms in `concepts.md#id`, or define local terms in this directory's `concepts.md`.

## Getting Started

Show one example a reader can follow as written: the commands or calls in order, and what the reader sees after each one. Copy real output once the feature runs; before that, mark it as expected output.

## How It Works

Explain the mechanism a user must understand to use the feature correctly. When a process involves several parties, state changes, or ordering, add a `p5` fence that loops through it; use Mermaid for static structure.

A sketch only illustrates rules stated in prose, so keep the conclusion readable without running it. Read `concord --skill view` for examples; declare extension libraries in project configuration, never in Markdown.

## User Paths

Link each Use Case, grouped by what the user is trying to do.

## Details

Put output fields, named errors, exit codes, failure semantics, scope boundaries, and performance budgets on the pages below, not in this README.

- [Library](library.md)
- [CLI](cli.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
