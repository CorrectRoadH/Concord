# {{title}}

## Observation

Describe the local, reproducible observation without assigning an unverified cause or remote status.

## Expected Behavior

For a defect, link the Spec page or anchor whose behavior is not met and state the expected observable result.

## Impact

State who or what is affected and how the impact can be observed.

## Reproduction

List the smallest repeatable steps, inputs, and resulting output.

## Investigation

Record evidence, ruled-out explanations, and remaining hypotheses. Put reusable findings in Memory and link them from the `relations` frontmatter with the `investigation`, `root-cause`, or `decision` role.

To close a defect as fixed, first commit a failing regression test marked `@issue docs/issues/<id>.md`. Then commit the fix and run `concord issue close <id> --fixed`. The command verifies both commits and writes the closure.
