# Concord

**Develop from specs: people review the spec, agents implement it and prove it with tests, and Concord checks that the three agree.**

English · [简体中文](README.zh-CN.md)

Concord is a local spec-driven development tool for developers and coding agents. The spec is the single source of truth for what the software must do. People review changes to the spec; agents implement the spec and prove it with tests; Concord checks that the spec, the implementation, and the tests still agree. A CLI and a bundled web workspace work with the same repository files.

Everything is a plain file in your Git worktree, and people and agents edit all of them directly. Concord commands run the steps a change requires, such as verifying a fix. `concord check` verifies that specs, tests, and code still agree. The core workflow needs no account, model API, or cloud service.

## The development workflow: spec first

Concord follows spec-driven development (SDD): define the intended behavior before implementing it, and keep that spec as the basis for later changes. Your project chooses its language, package manager, and test runner.

1. **Read the current intent.** Start with the relevant Feature, its Use Cases, and the project's rules. Follow existing links to code and tests before deciding what to change.
2. **Write and review the change in the spec.** Describe what the user does, what they observe, and how to verify it. Settle open design questions and put the chosen rules in the spec before implementing the affected behavior.
3. **Implement and test that behavior.** Link code and tests to the Use Case or step they serve. If the intended behavior needs to change during implementation, update the spec before continuing with that change.
4. **Verify and review the result.** Run `concord check` and the project's tests and quality checks. Review the spec diff alongside the related implementation and test results. A valid link alone does not establish that the behavior works.

Different roles usually take these steps. Whoever writes the spec settles names, behavior and verification. Implementers follow it and stop only when it is missing something or contradicts the facts.

Reviewers judge the result against the spec and actual runs; passing tests alone are not acceptance. A spec that implementers need not ask about lets people and agents work in parallel without guessing ([taste](docs/taste.md#t-11)).

The starting point depends on the change:

| Change | How to approach it |
| --- | --- |
| New or changed behavior | Update the Feature and affected Use Cases first, then implement and test them |
| A defect against the spec | Keep the intended behavior, commit a failing regression test, then commit the fix and [verify it](#fix-a-defect) |
| A refactor that preserves behavior | Keep the behavior spec stable; update architecture pages where the internal design changes and verify the existing behavior |

The [governance spec](docs/feature/neutral-project-governance/README.md) defines the shared rules; the [agent guide](skills/concord/SKILL.md) explains the tools used to follow them.

### When the spec changes, find the code and tests

Use Case links serve as a source map from product intent to implementation and tests. Code and tests declare their links in source; Concord derives the reverse mapping. You can start at a Use Case or one of its steps and find the functions, code regions, and tests to inspect when that behavior changes.

For example, changing how a greeting handles an empty name starts in its Use Case. In a project with the `greeting` Feature from the [quick start](#quick-start), inspect its relationships and the project's gaps:

```sh
concord --fresh trace show docs/feature/greeting/use-case/greet-name.md
concord --fresh trace gaps
```

Existing links identify code and tests to review when behavior changes. Gaps identify behavior with no declared implementation or test relationship. Investigate each gap to decide whether work is missing or existing code needs a link.

Linked code still needs to be checked against the changed spec. The mapping does not decide semantic correctness automatically.

See [relationship gaps](docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md) and [trace and review](docs/feature/local-sdlc/use-case/review-traceability.md).

## The problem Concord solves

Concord starts from three problems.

**Specs that nobody can read.** A spec written as a long list of constraints, fields, and edge cases leaves readers unable to say what the feature does or what to run first. A spec nobody understands is not really reviewed, so nobody maintains it.

Concord asks for features written the way you would teach someone to use them: what you can do, then an example you can follow as written. Use Cases read like tutorials, and processes that prose cannot make clear get a p5 animation.

**AI that uses words loosely.** An agent may rename the same thing in every session or switch between spellings, and readers are left guessing whether two words mean the same thing. In Concord each concept has one name and one definition in `concepts.md`, and `check` reports an old name wherever it appears.

**AI that writes piles of useless tests.** Agents happily add a test for every function and branch. Soon nobody can say which test guards which use, and reading the tests tells you nothing about how the product should behave.

Concord asks every test to name the Use Case, or the step of one, that it verifies, so tests read along user journeys. Tests that point at no Use Case are listed so you can inspect their purpose and decide how to handle them.

Around these problems sit the other complexities of building software with coding agents. Requirements live in chat threads and PR descriptions, and design tradeoffs live in someone's memory. Every agent session starts from zero and may re-decide settled semantics. A test claims to protect a feature, but nobody can tell which behavior it guards.

Bugs are declared fixed without evidence. Reviewing thousands of generated lines is also harder than reviewing the few sentences of intent behind them.

Concord starts review from the spec. The spec is Markdown in the repository. Code and tests point to it through source annotations, and the tool derives the reverse links from source. A reviewer reads how the spec changed, follows its links to implementation and tests, and checks the results against the intended behavior.

## How Concord handles development complexity

| Complexity | What Concord does | What you get |
| --- | --- | --- |
| Specs are unreadable, so review is a formality | The README and CLI page are the product guide; the architecture page is the technical design; Use Cases describe distinct user goals or paths, with output and tables for variations along the same path | A first-time reader can say what the feature does and how to start, and a reviewer can see how the intent changed |
| Processes and timing are hard to explain in prose | A `p5` fence in Markdown plays as a looping animation in the web workspace; Mermaid covers static structure | One loop of an animation shows a multi-party flow or a state change; the prose stays the rule and the sketch only illustrates it |
| People and agents use different words for one thing | `concepts.md` gives each concept one name and a definition, scoped by directory; `check` reports deprecated names | Readers do not guess whether two words mean the same thing, and an agent reading literally finds only one meaning |
| Vague words and ever-longer sentences | `writing.md` bans words such as `helper` or `resolve` that hide responsibility and limits sentence and paragraph length; each rule gives a replacement and a reason | Implementers do not have to guess what the author meant |
| Every agent session starts from zero and re-decides settled questions | Cross-feature preferences live in the taste file, tradeoffs in Design records, and findings in Memory, all in the repository | A new session reads the current rules and their reasons instead of overturning them |
| A spec changes, but nobody knows where to update code or tests | Tests and code point to a Use Case or step through source annotations; reverse links and relationship gaps are derived from source | Start at the changed behavior, inspect the linked code and tests, and investigate gaps for missing work |
| Refactors churn the spec and the tests | Behavior pages (README, Use Case, CLI, library) are separate from the architecture page | A behavior-preserving refactor changes only the architecture page, so behavior pages and the tests pointing at them stay stable |
| Bugs are declared fixed without evidence | A defect becomes an Issue; `issue close --fixed` verifies that the runner fails on the defect commit and passes on the fix, deletes the Issue, and prints the result for the commit message | Reviewers can replay the verification from the recorded commits and test IDs |
| Specs, tests, and code drift apart | `concord check` reports broken links, markers that point at missing specs, and misused words | People and agents edit files directly and learn about mistakes right away |
| Development logs leak into the spec | Process goes to Memory and open questions go to Issues; `docs/` keeps only current declarations | The spec always describes what the system must do now |
| Ideas are not settled, or settled but not scheduled | Roadmap keeps a direction in Feature form until `roadmap start` moves it into `docs/feature/` | Unsettled directions are never mistaken for current requirements |

## Every file in a Concord repository

A file's location and its single top-level heading give it identity, kind, and name. Frontmatter holds only facts that cannot be derived, such as an Issue's status. See the [document model](docs/document-model.md) for exact fields.

**Spec: what the system must do now**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/feature/<f>/README.md` | Entry point of the product guide, written as a tutorial: who uses it, what they can do, a getting-started example, how it works (with a diagram), and links to its Use Cases | Anyone meeting the feature for the first time |
| `docs/feature/<f>/use-case/<u>.md` | One user journey: starting state, numbered steps with `{#step-id}`, commands, output, and the result; distinct goals or paths get separate Use Cases, while input and error variations along the same path can use a table | Before implementing or writing tests; test annotations point here |
| `docs/feature/<f>/cli.md`, `library.md`, `api.md` | Exact calls for commands, libraries, or network protocols: output, `--json` fields, exit codes, and named errors | Agents and scripts integrating with the feature; these fields are a public contract |
| `docs/feature/<f>/format.md`, `ui.md`, `performance.md` | File formats users edit or read, interface layout and interaction, and performance budgets | When writing those files, building the interface, or changing a frequent command |
| `docs/feature/<f>/architecture.md`, `data-model.md` | Technical design: modules and ownership, data flow, invariants, failure stages, resource lifecycles, and internal storage | When changing the implementation; a behavior-preserving refactor changes only these pages |
| `docs/engineering/<t>/` | One maintainer capability of this repository, such as build, testing, or performance measurement, using the Feature page kinds | Maintainers of the repository |
| `docs/architecture.md` | System boundaries and modules across features | When a change spans several features |

**Project rules: what every spec follows**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/taste.md` | Long-lived cross-feature rules with stable clause IDs; sentences that rely on a rule link its ID | Before planning, implementing, or reviewing any feature |
| `docs/concepts.md`, `docs/**/concepts.md` | Glossary: each second-level heading is one concept, the heading is its only spelling, and the first paragraph is its definition; frontmatter lists deprecated names | Before writing a domain term; the directory sets the scope |
| `docs/writing.md`, `docs/**/writing.md` | Writing policy: banned words with replacements and reasons, sentence and paragraph limits | Enforced by `check`; writers read the reason when reported |

**Proposals and decision records: why it was designed this way**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/roadmap/<r>/` | A direction not yet adopted, written like a Feature; code and tests do not point at it | When discussing what to build next; `roadmap start` moves it into `docs/feature/` |
| `docs/design/<d>.md` | One open tradeoff: the options and what each costs; once decided, the rule moves into the spec and the page is deleted | When discussing that tradeoff |

**Work items and knowledge: what is wrong and what was learned**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/issues/<i>.md` | A defect, request, or observation still to handle; deleted once handled, with the result in the commit message | When picking up a problem |
| `memory/<m>.md` | Reusable lessons from development: measurements, root causes, tradeoffs made; rewritten or deleted when outdated | Before related work, found with `concord memory search` |

**Setup, source, and derived data**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| The Concord block in `AGENTS.md` | Tells agents to read the Concord guidance and run the check before delivery | Agents, every time they enter the repository |
| `concord.config.ts` | Optional configuration: source roots, test roots, test runner, p5 libraries | Only when the defaults do not fit |
| Annotations in source and tests | `// @use-case <path>` at the top of a test, `// @concord-implements <path>` next to code | Read by `check` and `trace` to derive reverse links |
| `concord/` in the Git private directory | Per-worktree cache, write recovery records, and leases | Not for reading; `concord cache clear` removes the cache without changing results, while recovery records are handled by `concord recover` and must not be deleted by hand |

## What you can do

- **Define the work.** Write Features and Use Cases, compare design alternatives, and record an explicit decision before implementation.
- **Find the implementation.** Follow a spec to its annotated files, functions, code regions, and tests. Reverse links are derived from source.
- **Prove fixes.** Record a defect as an Issue, commit a failing regression test, commit the fix, and close the Issue with a verified, replayable result.
- **Explain mechanisms with diagrams.** Write a `p5` fence in a spec and the web workspace plays it as a loop, showing multi-party flows and state changes.
- **Keep one word per concept.** Define concepts in `concepts.md` and banned words in `writing.md`; `check` reports old names and vague words with their replacements.
- **Review in context.** Inspect specs, source, tests, Issues, feedback, and Git changes in the web workspace, or generate local review material from the CLI.

## Install

With one command on Linux x64 or Apple Silicon macOS (needs only Git; installs into your home directory):

```sh
curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
concord --help
```

With Homebrew on Linux or Apple Silicon macOS:

```sh
brew install CorrectRoadH/tap/concord
concord --help
```

With Nix on Linux:

```sh
nix profile install 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord'
concord --help
```

Concord ships with its own Node.js runtime and ripgrep, so it needs only Git. It runs on Linux x64 with glibc 2.39 or newer (Ubuntu 24.04 and later) and on Apple Silicon macOS 15 or newer; Windows is not supported.

## Quick start

In an existing Git repository, initialize Concord:

```sh
concord init
concord new feature greeting --title "Greeting" --pages use-case
concord new use-case greet-name --feature greeting --title "Greet a name"
```

Concord discovers `src/`, `test/`, and `tests/` by default, so `concord.config.ts` is optional. Pass `--source-root` or `--test-root` when your code lives elsewhere, or `--docs-only` for a repository without tests. Initialization creates document templates, a taste file, and an agent guidance block in `AGENTS.md`.

`new` only fills a template; you can create the same files by hand. Write the intended behavior directly in them:

```text
docs/feature/greeting/README.md
docs/feature/greeting/use-case/greet-name.md
```

Link the implementation with a comment immediately before the relevant declaration:

```ts
// @concord-code
// @concord-implements docs/feature/greeting/use-case/greet-name.md
export function greet(name: string): string {
  return `Hello, ${name.trim() || 'world'}!`;
}
```

Add the matching annotation to a test file under your test root:

```ts
// @use-case docs/feature/greeting/use-case/greet-name.md
```

Then inspect the relationships:

```sh
concord doctor
concord check
concord test list
concord show greeting
```

`check` validates relationships, lifecycle rules, and the project's writing policy; it does not run tests. To execute a test declaration, pass an ID returned by `concord test list` to `concord test run <id>`. The default runner uses Node's test runner; configure your project's runner in `concord.config.ts` when needed. See the [test guide](skills/concord/references/test.md).

## Fix a defect

1. Write the defect as an Issue: `concord new issue duplicate-sku`, or create `docs/issues/duplicate-sku.md` directly.
2. Commit a regression test that fails, annotated with `@issue docs/issues/duplicate-sku.md`.
3. Commit the fix without changing the test, the runner configuration, or the spec it points to.
4. Run `concord issue close duplicate-sku --fixed --reason "..."`. Concord runs the configured runner on the defect commit and on HEAD. If verification succeeds, it deletes the Issue, removes its `@issue` markers, and prints the result to include in your commit message.

Keep the regression test and its Use Case link. Replay verification with `concord test verify`, using the test IDs and commits recorded in the commit message. This establishes the runner's result on those two snapshots, not complete test coverage. See [verify a fix and close a defect](docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md).

## Open the web workspace

```sh
concord view
```

Open the address printed in the terminal. The bundled workspace provides document editing, implementation and test relationships, Issues, Memory, feedback, terminology, and Git diffs. Use cases live inside their feature.

Without `--host`, the server listens on `127.0.0.1:4317`. It has no authentication: anyone who can reach the port can edit the repository and run configured tests. Pass `--host 0.0.0.0` only on a trusted network.

## Work with an agent

After initialization the project has four skills, one per workflow step. Trigger them with a slash command such as `/concord-spec` in Claude Code or `$concord-spec` in Codex; agents also pick them up when a task matches:

| Skill | What it does |
| --- | --- |
| `concord-spec` | Turn a request into a Feature and Use Cases and settle open questions |
| `concord-implement` | Implement from the spec and link code and tests; stop when the spec falls short |
| `concord-review` | Review a set of changes against the spec and actual runs |
| `concord-fix` | Follow the defect workflow: regression test, fix, verification |

Run `concord skills install` to add them to a repository that is already initialized. See [run the workflow from an agent](docs/feature/project-onboarding/use-case/run-workflow-from-agent.md).

Agents can also read the instructions shipped with the installed version, even outside an initialized repository:

```sh
concord --skill
concord --skill document
concord --skill code
concord --skill test
concord --skill memory
```

Use `concord <command> --help` for exact arguments, `--json` for structured results, and `--root /path/to/project` to target another worktree. Agents edit specs, Issues, and Memory directly; commands such as `issue close --fixed` and `roadmap start` run the steps those changes require.

## Go further

| Task | Guide |
| --- | --- |
| Understand the workflow and data ownership | [Spec-first workflow](#the-development-workflow-spec-first) · [Document model](docs/document-model.md) · [Architecture](docs/architecture.md) · [Agent workflow](skills/concord/SKILL.md) |
| Look up commands and outputs | [CLI](docs/feature/local-sdlc/cli.md) |
| Annotate files, functions, and code regions | [Code guide](skills/concord/references/code.md) |
| Run tests and verify fixes | [Test guide](skills/concord/references/test.md) |
| Record reusable knowledge | [Memory guide](skills/concord/references/memory.md) |
| Read GitHub and Linear feedback alongside local Issues | [Feedback commands](docs/feature/feedback/cli.md) |
| Decide what your project owns in testing | [Project test boundary](docs/feature/local-sdlc/README.md#测试的边界) |
| Explore the product specs | [Documentation](docs/README.md) |

The linked guides and specs are primarily in Chinese. These two README files cover the same introduction and getting-started workflow.

To work on Concord itself, see the [engineering guide](docs/engineering/self-hosting/README.md).
