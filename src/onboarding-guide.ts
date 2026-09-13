export const onboardingGuide = `# Developing with Concord

Concord connects current product contracts, real test declarations, and engineering memory.

## Choose the document that owns your intent

- [Feature](feature/README.md): the adopted product contract, even when implementation is still catching up.
- [Roadmap](roadmap/README.md): a settled direction awaiting adoption.
- [Design](design/README.md): goals, constraints, self-contained alternatives, and the reason for a decision.
- [Engineering](engineering/README.md): how this repository is tested and maintained.
- [Research](research/README.md): dated external facts and sources.
- [Memory](../memory/README.md): problems, decisions, and reusable lessons with their history.
- [Issues](issues/README.md): local observations awaiting investigation.

Write the intended behavior in contracts. Keep implementation progress in your work tracking and Git history.
Templates provide writing prompts, not completed requirements or evidence.

## Complete setup

Init installs every category, the documentation entry point, and the complete [template reference set](_template/README.md).
Create commands generate the full page structure, including all Design decision pages and candidate packages.
There is no page-selection step. Page add repairs missing template pages or adds a supporting topic using a lowercase slug, such as migration. Custom pages remain part of their package, with the same digest checks.

## First feature

\`\`\`
concord feature create login --title "Login"
concord use-case create expired-token --feature login --title "Reject expired tokens"
\`\`\`

Fill in the generated author prose. Use \`concord template list\` and \`concord template show feature\` to inspect bundled templates.
\`--body <file>\` supplies your own prose; \`--body -\` reads stdin.
\`page show\` returns the current digest; \`page set --expected-digest\` checks it before replacing a page.
Lifecycle metadata remains owned by the corresponding Concord commands.

## Connect a real test

Run \`concord test annotate login-rejects-expired-token --contract docs/feature/login/use-case/expired-token.md\`.
Place the output immediately above an existing supported test declaration. Keep its stable case ID with the test.
Then run \`concord check\`, \`concord test list\`, and \`concord trace show docs/feature/login/README.md\`.
Use \`--regression memory/<problem>.md\` when a test protects a recorded Problem.
Source annotations are the only owner of these test relations; reverse lists are derived.

## Configure and run verification

\`concord.json\` owns testRoots and runner configuration. Defaults scan test/ and tests/ using Node native tests.
For a documentation-only repository, initialize with \`concord init --docs-only\`: testRoots is empty and no test directories are required.
Add real test roots to concord.json when tests exist. A successful documentation check does not establish test coverage.
Use \`concord doctor\` to inspect the configuration and missing test roots without running repository commands.
For another runner, set runner to an object such as:

\`\`\`
{"kind":"command","argv":["your-runner","{file}"],"sourceFiles":[],"timeoutMs":60000}
\`\`\`

Replace the executable and arguments with your repository test command. Each placeholder must occupy one complete argument;
supported placeholders are {file}, {name}, and {pattern}. Arguments never run through a shell.
Include additional assertion or runner configuration files in sourceFiles. Concord does not install your dependencies.
Only \`concord test run <id>\` executes the runner. Check, trace, template, and doctor do not run tests.

Run results are command evidence, not proof that a native case executed or that a feature is covered.
For a Problem fix, capture a normal failing red command, change the product implementation, then capture green.
Keep the test definition and contract unchanged between both runs. Resolve using both receipt IDs and an explicit reason.
See \`concord memory resolve --help\`. Use \`concord review render\` for local review material.

## Working safely

\`--dry-run\` previews document mutations. Existing files are never overwritten by init or create.
\`--json\` emits machine-readable results. An empty repository can pass integrity checks without having tests.
Private evidence is per Git worktree and is not copied by a normal clone; missing historical evidence remains unavailable.
Use \`concord recover\` for an interrupted publication and \`concord cache rebuild\` for disposable cache repair.
`;
