# Concord

**Develop from specs: people review the spec, agents implement it and prove it with tests, and Concord checks that the three agree.**

English · [简体中文](README.zh-CN.md)

Concord is a local spec-driven development tool for developers and coding agents. The spec is the single source of truth for what the software must do. People review changes to the spec; agents implement the spec and prove it with tests; Concord checks that the spec, the implementation, and the tests still agree. A CLI and a bundled web workspace work with the same repository files.

Everything is a plain file in your Git worktree, and people and agents edit all of them directly. Concord commands run the steps a change requires, such as verifying a fix. In CI, `concord check --since <base>` checks that every change is legal. The core workflow needs no account, model API, or cloud service.

## The problem Concord solves

Concord starts from two problems.

**Specs that nobody can read.** A spec written as a long list of constraints, fields, and edge cases leaves readers unable to say what the feature does or what to run first. A spec nobody understands is not really reviewed, so nobody maintains it.

Concord asks for features written the way you would teach someone to use them: what you can do, then an example you can follow as written. Use Cases read like tutorials, and processes that prose cannot make clear get a p5 animation.

**AI that uses words loosely.** An agent may rename the same thing in every session or switch between spellings, and readers are left guessing whether two words mean the same thing. In Concord each concept has one name and one definition in `concepts.md`, and `check` reports an old name wherever it appears.

Around these two problems sit the other complexities of building software with coding agents. Requirements live in chat threads and PR descriptions, and design tradeoffs live in someone's memory. Every agent session starts from zero and may re-decide settled semantics. A test claims to protect a feature, but nobody can tell which behavior it guards.

Bugs are declared fixed without evidence. Reviewing thousands of generated lines is also harder than reviewing the few sentences of intent behind them.

Concord moves review to the spec. The spec is Markdown in the repository. Code and tests point to it through source annotations, and the tool derives the reverse links from source. A reviewer reads how the spec changed, and `concord check` verifies that implementation, tests, and records still match it.

## How Concord handles development complexity

| Complexity | What Concord does | What you get |
| --- | --- | --- |
| Specs are unreadable, so review is a formality | Feature pages come in three kinds. The README and CLI page are the product guide, written as a tutorial; the architecture page is the technical design; Use Cases are user journeys, one per situation in which the feature behaves differently, with real output | A first-time reader can say what the feature does and how to start, and a reviewer can see how the intent changed |
| Processes and timing are hard to explain in prose | A `p5` fence in Markdown plays as a looping animation in the web workspace; Mermaid covers static structure | One loop of an animation shows a multi-party flow or a state change; the prose stays the rule and the sketch only illustrates it |
| People and agents use different words for one thing | `concepts.md` gives each concept one name and a definition, scoped by directory; `check` reports deprecated names | Readers do not guess whether two words mean the same thing, and an agent reading literally finds only one meaning |
| Vague words and ever-longer sentences | `concord-writing.json` bans words such as `helper` or `resolve` that hide responsibility and limits sentence and paragraph length; each rule gives a replacement and a reason | Implementers do not have to guess what the author meant |
| Every agent session starts from zero and re-decides settled questions | Cross-feature rules live in the constitution, tradeoffs in Design records, and findings in Memory, all in the repository | A new session reads the current rules and their reasons instead of overturning them |
| Nobody knows which behavior a test guards | Tests point to a Use Case or one of its steps through an annotation; code points to the spec through a declaration; reverse links are derived from source | From a spec you can find the tests and code behind it, and the links appear in the same diff as the code |
| Refactors churn the spec and the tests | Behavior pages (README, Use Case, CLI, library) are separate from the architecture page | A behavior-preserving refactor changes only the architecture page, so behavior pages and the tests pointing at them stay stable |
| Bugs are declared fixed without evidence | A defect becomes an Issue; the regression test fails on the defect commit and passes on the fix, and `issue close --fixed` verifies both and records the result | Anyone can replay the fix verification |
| Direct edits bypass the process | CI runs `concord check --since <base>` on every change, checking status transitions, fix verifications, constitution amendments, and Design decisions | People and agents edit files directly, and the gate decides whether a change is legal |
| Development logs leak into the spec | Process goes to Memory and open questions go to Issues; `docs/` keeps only current declarations | The spec always describes what the system must do now |
| Ideas are not settled, or settled but not scheduled | Roadmap keeps a direction in Feature form until `roadmap adopt` moves it into `docs/feature/`; Research keeps dated external facts with sources | Unsettled directions are never mistaken for current requirements |

## Every file in a Concord repository

A file's location and its single top-level heading give it identity, kind, and name. Frontmatter holds only facts that cannot be derived, such as an Issue's status. See the [document model](docs/document-model.md) for exact fields.

**Spec: what the system must do now**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/feature/<f>/README.md` | Entry point of the product guide, written as a tutorial: who uses it, what they can do, a getting-started example, how it works (with a diagram), and links to its Use Cases | Anyone meeting the feature for the first time |
| `docs/feature/<f>/use-case/<u>.md` | One user journey in one situation: starting state, numbered steps with `{#step-id}`, commands and output, and the result; a feature that behaves differently in several situations has several Use Cases | Before implementing or writing tests; test annotations point here |
| `docs/feature/<f>/cli.md`, `library.md` | Exact calls, human output, `--json` fields, exit codes, and named errors | Agents and scripts integrating with the feature; these fields are a public contract |
| `docs/feature/<f>/architecture.md` | Technical design: ownership, data flow, invariants, failure stages, and resource lifecycles | When changing the implementation; a behavior-preserving refactor changes only this page |
| Other pages in `docs/feature/<f>/` | Supporting pages, such as performance budgets or file formats | Reached from the README when the detail is needed |
| `docs/engineering/<t>/` | How the repository itself is built, tested, and released, in Feature form | Maintainers of the repository |
| `docs/architecture.md` | System boundaries and modules across features | When a change spans several features |

**Project rules: what every spec follows**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/constitution.md` | Long-lived cross-feature rules with stable clause IDs; sentences that rely on a rule link its ID | Before planning, implementing, or reviewing any feature |
| `docs/concepts.md`, `docs/**/concepts.md` | Glossary: each second-level heading is one concept, the heading is its only spelling, and the first paragraph is its definition; frontmatter lists deprecated names | Before writing a domain term; the directory sets the scope |
| `docs/concord-writing.json`, `docs/**/concord-writing.json` | Writing policy: banned words with replacements and reasons, sentence and paragraph limits | Enforced by `check`; writers read the reason when reported |

**Proposals and decision records: why it was designed this way**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/roadmap/<r>/` | A direction not yet adopted, written like a Feature; code and tests do not point at it | When discussing what to build next; `roadmap adopt` moves it into `docs/feature/` |
| `docs/design/<d>/` | One comparison of approaches: README states the question, GOALS and LIMITS the targets and constraints, CASES the scenarios, `plans/<candidate>/` each complete candidate, DECISION the choice and reason | Only when revisiting that decision; current rules live in the spec |
| `docs/research/<r>/` | External facts with observation dates and sources | When a decision needs outside evidence |

**Work items and knowledge: what is wrong and what was learned**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| `docs/issues/<i>.md` | A defect, request, or observation; frontmatter holds status and relations, and a fixed closure records its verification | When picking up a problem; `issue close` writes the closure |
| `memory/<m>.md` | Reusable knowledge as a decision, insight, or note; each constitution amendment has a decision | Before related work, found with `concord memory recall` |

**Setup, source, and derived data**

| File | What it is | Who reads it, and when |
| --- | --- | --- |
| The Concord block in `AGENTS.md` | Tells agents to read the Concord guidance and run the check before delivery | Agents, every time they enter the repository |
| `concord.config.ts` | Optional configuration: source roots, test roots, test runner, p5 libraries | Only when the defaults do not fit |
| `docs/_template/` | Complete reference templates installed by `concord init` | When unsure how to write a kind of page |
| Annotations in source and tests | `// @use-case <path>` at the top of a test, `// @concord-implements <path>` next to code | Read by `check` and `trace` to derive reverse links |
| `concord/` in the Git private directory | Per-worktree cache, write recovery records, and leases | Not for reading; `concord cache clear` removes the cache without changing results, while recovery records are handled by `concord recover` and must not be deleted by hand |

## What you can do

- **Define the work.** Write Features and Use Cases, compare design alternatives, and record an explicit decision before implementation.
- **Find the implementation.** Follow a spec to its annotated files, functions, code regions, and tests. Reverse links are derived from source.
- **Prove fixes.** Record a defect as an Issue, commit a failing regression test, commit the fix, and close the Issue with a verified, replayable result.
- **Explain mechanisms with diagrams.** Write a `p5` fence in a spec and the web workspace plays it as a loop, showing multi-party flows and state changes.
- **Keep one word per concept.** Define concepts in `concepts.md` and banned words in `concord-writing.json`; `check` reports old names and vague words with their replacements.
- **Review in context.** Inspect specs, source, tests, Issues, feedback, and Git changes in the web workspace, or generate local review material from the CLI.

Concord adopts a spec-first workflow while leaving your language, package manager, and test runner to your project. An annotation declares a relationship, and a test run reports one execution. Neither is a claim of complete test coverage.

## Install

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

The runtime requires Node.js 24.15+ and Git; repository tools also use `ripgrep`. Release packages include the native cache engine, so consumers do not need Rust or a database service.

Packaged native targets are Linux x64/glibc and macOS arm64, with macOS 15 as the minimum deployment target.

Source releases require the complete test suite and a frozen production installation check of the final archive. Homebrew and Nix channel updates require their own installation checks.

macOS 27 is permitted but has not been verified in CI. Windows execution and coordination across multiple networked machines are outside the compatibility statement. See the [release spec](docs/feature/cross-platform-release/README.md) for details.

## Quick start

In an existing Git repository, initialize Concord:

```sh
concord init
concord new feature greeting --title "Greeting" --pages use-case
concord new use-case greet-name --feature greeting --title "Greet a name"
```

Concord discovers `src/`, `test/`, and `tests/` by default, so `concord.config.ts` is optional. Pass `--source-root` or `--test-root` when your code lives elsewhere, or `--docs-only` for a repository without tests. Initialization creates document templates, a project constitution, and an agent guidance block in `AGENTS.md`.

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
4. Run `concord issue close duplicate-sku --fixed --reason "..."`. Concord runs the test on the defect commit and on HEAD, and writes the verification into the Issue.

`concord test verify duplicate-sku` replays the recorded verification. In CI, `concord check --since <base>` replays any verification a change adds. See [verify a fix and close a defect](docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md).

## Open the web workspace

```sh
concord view
```

Open the address printed in the terminal. The bundled workspace provides document editing, implementation and test relationships, Issues, Memory, feedback, terminology, and Git diffs. Use cases live inside their feature.

Without `--host`, the server listens on `127.0.0.1:4317`. It has no authentication: anyone who can reach the port can edit the repository and run configured tests. Pass `--host 0.0.0.0` only on a trusted network.

## Work with an agent

Agents can read the instructions shipped with the installed version, even outside an initialized repository:

```sh
concord --skill
concord --skill document
concord --skill code
concord --skill test
concord --skill memory
```

Use `concord <command> --help` for exact arguments, `--json` for structured results, and `--root /path/to/project` to target another worktree. Agents edit specs, Issues, and Memory directly; commands such as `issue close --fixed`, `design decide`, and `roadmap adopt` run the steps those changes require.

## Go further

| Task | Guide |
| --- | --- |
| Understand the workflow and data ownership | [Why Concord](docs/why-concord.md) · [Document model](docs/document-model.md) · [Architecture](docs/architecture.md) · [Agent workflow](docs/agent-workflow.md) |
| Look up commands and outputs | [CLI](docs/feature/local-sdlc/cli.md) |
| Annotate files, functions, and code regions | [Code guide](skills/concord/references/code.md) |
| Run tests and verify fixes | [Test guide](skills/concord/references/test.md) |
| Record reusable knowledge | [Memory guide](skills/concord/references/memory.md) |
| Read GitHub and Linear feedback alongside local Issues | [Feedback commands](docs/feature/feedback/cli.md) |
| Decide what your project owns in testing | [Project test boundary](docs/repository-profile.md) |
| Explore the product specs | [Documentation](docs/README.md) |

The linked guides and specs are primarily in Chinese. These two README files cover the same introduction and getting-started workflow.

## Develop Concord

Source builds require Node.js 24.15+, pnpm 11.18.0, Git, Rust 1.97.1, and a native C linker toolchain.

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile # bootstrap the pinned local vp
rustup toolchain install 1.97.1 --profile minimal
pnpm exec vp build
pnpm exec vp run concord --help
pnpm exec vp run check
```

`pnpm check` (also available as `vp run check`) is the only check entry. It first builds the CLI and web workspace, reusing validated native artifacts. It then type-checks repository, test, and script sources and checks the current checkout's specs in parallel. Finally, it runs the packed CLI's Node and browser suites concurrently in isolated Git consumers.

Run `pnpm concord trace show local-sdlc` to inspect relationships from source.

When Vite+ is not installed globally, use `pnpm exec vp`. The `vp install` command manages dependencies through the pinned pnpm version.

The command `pnpm check test/writing-cache.test.ts` runs selected files after the complete build and static checks. Pass `--test-name-pattern=...` to select cases or `--test-shard=1/4` to split the complete suite. Selected tests never replace the full gate.

`vp run check` is the full delivery gate. The `vp build` production hooks prepare the complete distribution. Vite+'s built-in `vp check` and `vp test` do not invoke the project's scripts. Tests use Node's runner, share one packed artifact per invocation, and install isolated consumers. Task caching is disabled; partial checks do not replace full acceptance.

Read the [development rules](AGENTS.md) and [constitution](docs/constitution.md) before contributing. Concord originated in NiceEval's repository workflows and runs independently; the [provenance document](docs/provenance.md) describes the extraction boundaries.
