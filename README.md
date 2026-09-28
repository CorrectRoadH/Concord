# Concord

**Connect what you intend to build with the code, tests, and decisions behind it.**

English · [简体中文](README.zh-CN.md)

Concord is a local development workflow tool for developers and coding agents. It keeps product contracts in Markdown, links implementations and tests through source annotations, and preserves engineering knowledge in Memory. A CLI and a bundled web workspace work with the same repository data.

Start with a contract, implement and test it, then trace the relationships when reviewing a change or investigating a bug. The core workflow runs in your Git worktree, without an account, model API, or cloud service.

## What you can do

- **Define the work.** Describe features and use cases, compare design alternatives, and record an explicit decision before implementation.
- **Find the implementation.** Follow a contract to its annotated files, functions, code regions, and tests. Reverse links are derived from source.
- **Keep useful history.** Capture problems, decisions, and insights in Memory. Close a problem as fixed with matching red and green execution evidence.
- **Review in context.** Inspect contracts, source, test evidence, feedback, and Git changes in the web workspace, or generate local review material from the CLI.

Concord adopts a contract-first workflow while leaving your language, package manager, and test runner to your project. An annotation declares a relationship; a command receipt records an execution result. Neither is a claim of complete test coverage.

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

Packaged native targets are Linux x64/glibc and macOS arm64, with macOS 15 as the minimum deployment target. Automated releases build and verify package identity without tests or installation checks; macOS 27 is permitted but has not been verified in CI. Windows execution and coordination across multiple networked machines are outside the compatibility contract. See the [release contract](docs/feature/cross-platform-release/README.md) for details.

## Quick start

In an existing Git repository, initialize Concord with your source and test directories:

```sh
concord init --source-root src --test-root test
concord feature create greeting --title "Greeting"
concord use-case create greet-name --feature greeting --title "Greet a name"
```

For a repository without tests, use `concord init --docs-only` instead. Initialization creates `concord.config.ts`, document templates, a project constitution, and an agent guidance block in `AGENTS.md`.

Write the intended behavior in the generated documents:

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

Add the matching contract annotation to a test file under your configured test root:

```ts
// @use-case docs/feature/greeting/use-case/greet-name.md
```

Then inspect the relationships:

```sh
concord doctor
concord check
concord code list
concord test list
concord trace show greeting
```

`check` validates relationships, lifecycle rules, and the project's writing policy; it does not run tests. To execute a test declaration, pass an ID returned by `concord test list` to `concord test run <id>`. The default runner uses Node's test runner; configure your project's runner in `concord.config.ts` when needed. See the [test guide](skills/concord/references/test.md).

## Open the web workspace

```sh
concord view --host 127.0.0.1
```

Open the address printed in the terminal. The bundled workspace provides document editing, implementation and test relationships, execution evidence, Memory, feedback, terminology, and Git diffs. Use cases live inside their feature.

Without `--host`, the server listens on `0.0.0.0:4317`. It has no authentication: anyone who can reach the port can edit the repository and run configured tests. Use that binding only on a trusted network.

## Work with an agent

Agents can read the instructions shipped with the installed version, even outside an initialized repository:

```sh
concord --skill
concord --skill document
concord --skill code
concord --skill test
concord --skill memory
```

Use `concord <command> --help` for exact arguments, `--json` for structured results, and `--root /path/to/project` to target another worktree. Memory and Issue records are maintained through Concord commands, including their history and lifecycle transitions.

## Go further

| Task | Guide |
| --- | --- |
| Understand the workflow and data ownership | [Architecture](docs/architecture.md) · [Agent workflow](docs/agent-workflow.md) |
| Annotate files, functions, and code regions | [Code guide](skills/concord/references/code.md) |
| Run tests and inspect evidence | [Test guide](skills/concord/references/test.md) |
| Capture and resolve engineering problems | [Memory guide](skills/concord/references/memory.md) |
| Read GitHub and Linear feedback alongside local observations | [Feedback commands](docs/feature/feedback/cli.md) |
| Adopt native test inventory and reliability policies | [Advanced test governance](docs/repository-profile.md) |
| Explore the product contracts | [Documentation](docs/README.md) |

The linked guides and contracts are primarily in Chinese. These two README files cover the same introduction and getting-started workflow.

## Develop Concord

Source builds require Node.js 24.15+, pnpm 11.18.0, Git, Rust 1.97.1, and a native C linker toolchain.

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile
rustup toolchain install 1.97.1 --profile minimal
pnpm build
pnpm concord --help
pnpm check
```

`pnpm check` builds the CLI and web workspace, type-checks implementation, tests, and scripts, and runs tests including packed CLI installation in isolated Git consumers. To inspect Concord's own relationships, run `pnpm concord check` or `pnpm concord trace show local-sdlc`.

Read the [development rules](AGENTS.md) and [constitution](docs/constitution.md) before contributing. Concord originated in NiceEval's repository workflows and runs independently; the [provenance document](docs/provenance.md) describes the extraction boundaries.
