# Concord development

Concord is a standalone local SDLC CLI extracted from NiceEval's repository workflows.
Read `docs/architecture.md` for the adopted contract and `docs/provenance.md` for extraction boundaries.
Read `docs/constitution.md` before planning, implementing, or reviewing a feature. Feature and Design owners cite applicable clause anchors through `constitutionRefs`; propose explicit constitution amendments when a feature changes a project-wide rule, recording its reason, sources, and impact.
Do not depend on a NiceEval checkout, workspace package, provider credential, deployment service, or global installation.

Keep contracts, executable test definitions, and engineering memories in their own owners. Derive reverse relations; do not store a second registry. Do not claim command receipts prove native test coverage or NiceEval formal E2E reliability.

Contract prose declares intended behavior, constraints, and acceptance; product workflows belong in contracts. Keep development logs, investigation history, and delivery progress in Memory. Use Concord tools for Memory and Issue indexing, recall, reading, creation, author updates, relations, and lifecycle changes; do not directly read or edit their owner files or maintain a manual INDEX. Read `concord --skill memory` or `concord --skill feedback` for the current workflow.

Structured terminology and writing policy are owned by directory-scoped `concepts.json` and `concord-writing.json` under docs. Use Concord tools to maintain these JSON owners; derive the project glossary and references instead of duplicating definitions in Markdown or a second index. Markdown explains concepts and examples. Only deprecated names generate terminology bans; permitted aliases do not.

Effect dependencies stay on the exact pinned revision. Read the installed `effect/AGENTS.md` before using its APIs. Use strict Schema decoding at untrusted boundaries and named failures.

Maintain implementation, tests, and build scripts in strict TypeScript with Effect for execution and side effects. Do not add hand-maintained JavaScript scripts or bypass type checking. JavaScript build output and explicit JavaScript-consumer compatibility fixtures are distinct from maintained implementation sources.

The sole native exception is `native/hawdb`: Rust N-API engine bindings, required linker glue, byte conversion, resource budgets, and the revision-bound HawDB directory ownership guard. Keep domain decisions, Schema validation, publication authority, tests, and build orchestration in TypeScript/Effect. Pin the engine revision, Rust toolchain and bridge dependencies. Persistent handles end with the source snapshot, before any owned publication lease; in-memory cache handles belong to the process. Pack target-native artifacts so consumers need no Rust compiler or HawDB service. Engine upgrades must revalidate ownership and clear against the pinned lock protocol.

Use the project-pinned Vite+ toolchain. Bootstrap with `pnpm install --frozen-lockfile`; use `vp install` thereafter, or `pnpm exec vp` when no global CLI is installed. Keep the pinned pnpm package manager and lockfile.

- `vp build` produces the complete distribution through production build hooks, including native bindings, CLI, Web, Preview, and packaged resources. `vp dev` starts only the Web development server.
- `vp run check:fast` checks CLI and Web source types without building or running tests.
- After rebuilding changed sources, use `vp run typecheck:built` and `vp run test:built [files...]` for checks against the current artifacts. The test entry supports `--test-name-pattern=...` and `--test-shard=1/4`.
- `vp run check` (equivalent to `pnpm check`) is the full delivery gate: build, type checks, and tests of the packed public CLI in isolated Git consumers. Partial checks do not replace it. Vite+'s built-in `vp check` and `vp test` do not run this project's check script or Node test suite.

Keep task-result caching disabled for acceptance. Do not rebuild the same `dist` while tests or measurements are running; use a separate checkout when concurrent builds are necessary. Preserve one packed artifact per test invocation and independently installed consumers. See [build and check entrypoints](docs/engineering/concord-self-hosting/README.md#构建与检查入口) for the maintained workflow. Report failed or skipped checks explicitly.

No paid model calls, external mutations, production operations, publishing, or pushing without explicit user authorization.

Workers are not alone in this repository. Preserve other changes, stay within assigned paths, and do not commit unless assigned. Do not use built-in subagents. Herdr delegation follows the user's global guide.
