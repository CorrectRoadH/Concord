// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#agent-指引的边界
export const onboardingGuide = `# Developing with Concord

Concord drives development by connecting current product contracts, implementation declarations, real test declarations, and engineering memory. Before changing behavior, update or confirm the owning Feature, leaf Use Case, documented CLI page, and any required Design.

## Connect implementation to contracts

Configure sourceRoots in concord.config.ts, or initialize with --source-root src (repeatable).

Run concord --skill code for file, function and statement-region declarations. Use code marker to generate comments, code at <path>:<n> to inspect all containing scopes, and trace show to reverse-query the contract.

Code declarations describe implementation associations, not completion or test coverage.

## Choose the document that owns your intent

- [Feature](feature/README.md): the adopted product contract, even when implementation is still catching up.
- [Roadmap](roadmap/README.md): a product direction in the same genre as Feature that has not been adopted yet. Its design is incomplete, or it is designed but not scheduled.
- Design: one open tradeoff in docs/design/<name>.md; write the adopted rule in Spec and delete the Design when decided.
- [Engineering](engineering/README.md): how this repository is tested and maintained.
- [Memory](../memory/README.md): decisions, insights, and notes.
- [Issues](issues/README.md): local observations awaiting investigation.

Write contracts as declarations of intended behavior, constraints, and acceptance. Product workflows and lifecycle rules belong in contracts. Development logs, investigation history, and implementation progress belong in Memory. Observations awaiting investigation belong in Issues.

Behavior pages (Feature README, Use Case, cli, library) state commands, real human and JSON output, exit codes, and named errors. The architecture page states how the Feature is implemented. Run \`concord --skill document\` for the full rules.

Templates provide writing prompts, not completed requirements or evidence.
Read docs/taste.md before creating or revising Feature and Design owners. Link each applicable clause or paragraph ID next to the sentence that relies on it. The check command validates every taste link under docs. Use \`concord taste\` to list where each rule is referenced.

## Recall and maintain local knowledge

Use \`concord memory search "query" --json\` and \`concord issue search "query" --json\` to search current knowledge. Indexes and reverse relations are derived; do not maintain a manual INDEX.

Every file under docs/ and memory/ can be edited directly, including relations. Create scaffolds with \`concord new memory <name>\` or \`concord new issue <name>\`. Commands run required steps such as fix verification. Run \`concord check\` before delivery.

Local issues require no external account or connection. Local changes never authorize remote writes.

## Scoped concepts and writing

Use \`concord concepts index --json\` for a derived project glossary. The global catalog is docs/concepts.md; each Feature, Engineering, or other docs subdirectory may own its own concepts.md and concord-writing.json. The containing directory defines local scope.

Keep each stable ID, its single term, definition paragraph and explanation together in concepts.md. Use optional imports and deprecated YAML frontmatter. Only deprecated names generate terminology bans.

Edit concepts.md and concord-writing.json directly. Concord check validates their structure, scope and references. Do not duplicate definitions in a global aggregate.

Writing v3 composes ancestor policy within scope. Check saved inputs with \`concord docs check --json\`. Policies must match the current Schema. Only explicitly deprecated names are banned.

## Complete setup

Init installs every category, the documentation entry point, and the complete [template reference set](_template/README.md).
Init supplies the missing architecture.md outline, an empty global concepts.md catalog, and the global writing preset. Existing root documents, catalogs, and policies retain their bytes.

The preset limits sentences to 140 characters and paragraphs to 320. It checks vague wording and unused concepts in Markdown and MDX.

Feature, Roadmap, and each Design candidate require README. Select optional pages with \`--pages library,cli,architecture,use-case\`, or repeat \`--pages\`. Omission creates README only.

Design decision wrapper pages are always created. Engineering starts with README and expands by topic.

Add supporting pages by editing files directly and link them from README. Design candidates use plans/name.md or plans/name/README.md, never both.

Document IDs and Use Case filenames also accept Unicode letters, combining marks and numbers, with single hyphen separators; spelling is preserved. Names cannot contain path separators, whitespace or traversal components.

## First feature

\`\`\`
concord new feature login --title "Login"
concord new use-case expired-token --feature login --title "Reject expired tokens"
\`\`\`

Fill in the generated author prose. Use \`concord template list\` and \`concord template show feature\` to inspect bundled templates.

\`--body <file>\` supplies your own prose; \`--body -\` reads stdin.

\`page show\` returns the current digest; \`page set --if-unchanged\` checks it before replacing a page.
Lifecycle metadata remains owned by the corresponding Concord commands.

## Connect a real test

Place \`// @use-case docs/feature/login/use-case/expired-token.md\` in the test file. \`//\`, \`#\`, and \`--\` are markers. Concord derives the execution reference from the file and marker; no manual ID or attach step is needed.

Then run \`concord check\`, \`concord test list\`, and \`concord trace show docs/feature/login/README.md\`.

Run \`concord trace gaps --json\` to find contracts and documented CLI pages without explicit code or active test relationships. These are relationship gaps, not coverage results; product-owned inventory is still required to discover undocumented commands.

Add \`// @issue docs/issues/<id>.md\` beside the Spec marker when a test protects an Issue. Source annotations own these relations; Concord derives reverse lists and execution references. Use \`@status retired\` to retire an annotation.

Without \`@name\`, a run covers the marked file and does not claim a native case passed. Native test adapters report their own observed cases.

## Configure and run verification

\`concord.config.ts\` owns testRoots and runner configuration for projects. Unsupported input is rejected without conversion. Without configuration, discovery scans existing test/ and tests/ directories and existing src/ sources. No runner is configured by default. Explicit roots replace these defaults.

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

\`concord test run <id>\` executes the configured runner. Fix closure and replay also execute it; \`check --since <base>\` replays newly recorded fixes. Plain check, trace, template, and doctor do not run tests.

Run results are command evidence, not proof that a native case executed or that a feature is covered.

Close a defect through a reproducible regression:

1. Add a failing regression test marked with \`@issue docs/issues/<id>.md\` and commit it.
2. Commit the product fix while keeping the test, runner inputs and referenced Spec unchanged.
3. Run \`concord issue close <id> --fixed\` to verify the frozen command against the defect and fixed snapshots and record the result in the Issue.
4. Run \`concord check\` before delivery.

Use \`concord test verify <issue>\` to replay a recorded fix. Verification proves that one frozen command failed on the defect and passed on the accepted snapshot; it does not establish native case coverage. Use \`concord review\` for local review material.

## Working safely

\`--dry-run\` previews document mutations. Existing files are never overwritten by init or create.
\`--json\` emits machine-readable results. An empty repository can pass integrity checks without having tests.

Fix verification is recorded in its Issue and can be replayed with concord test verify.
Use \`concord recover\` for an interrupted publication and \`concord cache rebuild\` for disposable cache repair.
`;
