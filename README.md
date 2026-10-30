# Concord

**Develop from specs: people review the spec, agents implement it and prove it with tests, and Concord checks that the three agree.**

English · [简体中文](README.zh-CN.md)

Concord is a local spec-driven development tool for developers and coding agents. The spec is the single source of truth for what the software must do. People review changes to the spec; agents implement the spec and prove it with tests; Concord checks that the spec, the implementation, and the tests still agree. A CLI and a bundled web workspace work with the same repository files.

Everything is a plain file in your Git worktree, and people and agents edit all of them directly. Concord commands run the steps a change requires, such as verifying a fix. In CI, `concord check --since <base>` checks that every change is legal. The core workflow needs no account, model API, or cloud service.

## The problem Concord solves

In most projects, *what* to build, *how* it was built, and *why* it was built that way live in different places. Requirements sit in chat threads and PR descriptions. Design tradeoffs live in someone's memory. A test claims to protect a feature, but nobody can tell which behavior it actually guards.

Coding agents make this worse because every session starts from zero. An agent may re-decide settled semantics, use different words for the same thing, or declare a bug fixed without evidence. Reviewing thousands of generated lines is also harder than reviewing the few sentences of intent behind them.

Concord moves review to the spec. The spec is Markdown in the repository. Code and tests point to it through source annotations, and the tool derives the reverse links from source. A reviewer reads how the spec changed, and `concord check` verifies that implementation, tests, and records still match it.

## How a repository is organized

Documents are grouped by the question they answer. Location and the single top-level heading give each document its identity, kind, and name. Frontmatter holds only facts that cannot be derived, such as an Issue's status.

| Group | Documents | Answers |
| --- | --- | --- |
| Spec | Features under `docs/feature/`; the repository's own maintenance mechanisms under `docs/engineering/` | What the system must do now |
| Proposals | Roadmap under `docs/roadmap/`, written like a Feature | Directions not yet adopted |
| Project rules | Constitution, glossary (`concepts.md`), writing policy (`concord-writing.json`) | What every Feature follows |
| Decision records | Design and Research under `docs/design/` and `docs/research/` | Why it was designed this way |
| Work items | Issues under `docs/issues/` | What is wrong or still to do |
| Knowledge | Memory under `memory/` | What was learned |

A Feature consists of up to four kinds of pages. The README describes the capability, and Use Cases describe user paths with acceptance criteria. `architecture.md` describes the implementation, and `cli.md` or `library.md` shows concrete calls and outputs. See the [document model](docs/document-model.md) for locations and fields.

## Why each concept exists

| Concept | Problem it solves |
| --- | --- |
| Feature and Use Case | Record the behavior the product must have as a durable spec, written before implementation. A Use Case describes one user path with its main flow and acceptance criteria, which gives code and tests a target more specific than "the whole feature". |
| Behavior pages and architecture pages | README, Use Case, and example pages state what users observe; the architecture page states how it is built. A refactor that keeps behavior changes only the architecture page, so behavior pages and the tests that point at them stay stable. |
| Design | When several approaches are viable, compare candidates against shared goals and limits, then record one choice and its reason. The adopted rules move into the Spec, and the Spec links the decision as its rationale. |
| Roadmap and Research | Roadmap holds directions that are not yet adopted, written in the same form as a Feature; adoption moves it into `docs/feature/`. Research holds dated external facts with sources as decision input. |
| Glossary | Each concept has one preferred name, and `check` reports deprecated names. Directories scope definitions, so the same word can mean different things in different features. Agents read text literally, so a spec stays unambiguous only when its terms do. |
| Writing policy | Ban words that hide responsibility, such as `helper` or `resolve`, limit sentence and paragraph length, and give a replacement and a reason for each rule. Clear specs leave less for the implementation to guess. |
| Source annotations | Code and tests declare in source which spec they relate to, so the relationship appears in the same diff as the code. Reverse lists are derived, with no separate registry to drift. |
| Issue and fix verification | Defects, requests, and observations are Issues. A fix is proven at the commit level: the regression test fails on the commit that added it and passes on the fix, and the result is written into the Issue where anyone can replay it. |
| Memory | Reusable knowledge and decisions that need no Design. `docs/` therefore holds only current declarations, not development logs. |
| Project constitution | Records long-lived rules that span features. Pages cite the clauses they rely on, and each amendment is recorded as a decision in Memory. |
| Change gate | `concord check --since <base>` checks what a change did: status transitions, fix verifications, constitution amendments, and Design decisions. Direct edits stay trustworthy because CI runs it on every change. |

## What you can do

- **Define the work.** Write Features and Use Cases, compare design alternatives, and record an explicit decision before implementation.
- **Find the implementation.** Follow a spec to its annotated files, functions, code regions, and tests. Reverse links are derived from source.
- **Prove fixes.** Record a defect as an Issue, commit a failing regression test, commit the fix, and close the Issue with a verified, replayable result.
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
