# {{title}}

## User Goal

State who wants what and why, in the user's language. One goal per Use Case.

## Starting State

List what must already be true: configuration, existing documents, data, and any readiness condition needed to perform the journey.

## Complete Path

Write one numbered item per user action. Show the exact command or call and its output. Copy real output once the feature runs; before that, mark it as expected output. End the first paragraph of each item with a stable step ID such as `{#run-red}` so tests and code can point at that step.

For interactive explanations, an optional `p5` fence can show the process. State the initial conditions, controls and expected observation in prose. Readers explicitly run sketches; animation does not replace acceptance evidence. Keep Mermaid for static flows and read `concord --skill view` for p5 authoring and project library configuration.

## Result

Describe the observable end state, where to observe it, and what would make the journey fail acceptance. Check relevant side effects such as persisted data, messages, or released resources alongside the visible output. List every failure the user can see in a table of error code and trigger, with one real error output.

For retries, cancellation, concurrency, or recovery, describe the applicable failure paths, termination conditions, and state retained after failure. Reuse the steps and result table; link shared guarantees instead of maintaining a second checklist. Verification setup and cleanup belong in the project's Engineering pages.

## Contract Sources

Link only to existing pages that own the CLI, API, or architecture rules used by this path. Do not redefine those rules here. Implementation belongs in the architecture page, not here.
