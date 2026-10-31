# Your title

## User Goal

State who wants what and why, in the user's language. One goal per Use Case.

## Starting State

List what must already be true: configuration, existing documents, data.

## Complete Path

Write the path as a tutorial: one numbered item per user action, the exact command or call, and what the user sees. Copy real output once the feature runs; before that, mark it as expected output. End the first paragraph of each item with a stable step ID such as `{#run-red}` so tests and code can point at that step.

One Use Case covers one situation. When the feature behaves differently under another input, state, or failure, write another Use Case for that situation instead of listing rules here.

When a step involves several parties, state changes, or ordering, a `p5` fence can loop through the process. State the rule in prose first; the sketch only illustrates it and does not replace acceptance evidence. Keep Mermaid for static flows and read `concord --skill view` for p5 authoring and project library configuration.

## Result

Describe what the user sees at the end of this situation, with one real output. The complete list of error codes belongs on the CLI or library page; link it instead of repeating it.

## Contract Sources

Link only to existing pages that own the CLI, API, or architecture rules used by this path. Do not redefine those rules here. Implementation belongs in the architecture page, not here.
