// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
export const onboardingGuide = `# Developing with Concord

Concord connects current product contracts, real test declarations, and engineering memory.

## Connect implementation to contracts

Configure sourceRoots in concord.config.ts, or initialize with --source-root src (repeatable). Run concord --skill code for file, function and statement-region declarations. Use code annotate to generate comments, code locate <path> --line <n> to inspect all containing scopes, and trace show to reverse-query the contract. Code declarations describe implementation associations, not completion or test coverage.

## Choose the document that owns your intent

- [Feature](feature/README.md): the adopted product contract, even when implementation is still catching up.
- [Roadmap](roadmap/README.md): a settled direction awaiting adoption.
- [Design](design/README.md): goals, constraints, self-contained alternatives, and the reason for a decision.
- [Engineering](engineering/README.md): how this repository is tested and maintained.
- [Research](research/README.md): freeform research topics and supporting materials.
- [Memory](../memory/README.md): problems, decisions, and reusable lessons with their history.
- [Issues](issues/README.md): local observations awaiting investigation.

Write the intended behavior in contracts. Keep implementation progress in your work tracking and Git history.
Templates provide writing prompts, not completed requirements or evidence.
Read docs/constitution.md before creating or revising Feature and Design owners, and record applicable real clause anchors through constitutionRefs.

## Complete setup

Init installs every category, the documentation entry point, and the complete [template reference set](_template/README.md).
Init also supplies missing concepts.md and architecture.md writing outlines while preserving existing root documents.
Feature, Roadmap, and each Design candidate require README. Select optional pages with --pages library,cli,architecture,lifecycle,use-case, or repeat --pages; omission uses project defaults, and --no-pages explicitly creates README only. Design decision wrapper pages are always created. Engineering starts with README and expands by topic.
Page add adds optional pages or supporting topics using a lowercase slug, such as migration. Update the author-owned README links after adding pages. Custom pages remain part of their package, with the same digest checks.

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

Place \`// @use-case docs/feature/login/use-case/expired-token.md\` immediately above an existing supported test declaration. Concord derives the execution reference from the test file and test name; no manual ID or attach step is needed.
Then run \`concord check\`, \`concord test list\`, and \`concord trace show docs/feature/login/README.md\`.
Use \`--regression memory/<problem>.md\` when a test protects a recorded Problem.
Source annotations are the only source of these test relations; reverse lists are derived. Put \`// @feature <canonical path>\` or \`// @use-case <canonical path>\` above a top-level test. Concord derives the \`neref_...\` test reference; use \`@regression\` for a Problem and \`@status retired\` to retire a generic relation. Repository profile additionally supports \`@issue\` and helper \`@test-file\`.

## Configure and run verification

\`concord.config.ts\` owns testRoots and runner configuration for projects; old \`concord.json\` requires explicit offline migration. Defaults scan test/ and tests/ using Node native tests.
For a documentation-only repository, initialize with \`concord init --docs-only\`: testRoots is empty and no test directories are required.
Add real test roots to the project configuration when tests exist. A successful documentation check does not establish test coverage.
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
