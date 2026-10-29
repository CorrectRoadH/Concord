# Concord development

Concord is a standalone local SDLC CLI extracted from NiceEval's repository workflows.
Read `docs/architecture.md` for the adopted contract and `docs/provenance.md` for extraction boundaries.
Read `docs/constitution.md` before planning, implementing, or reviewing a feature. Current behavior lives in Feature, Use Case, architecture and engineering pages; decided Designs are decision records, so promote adopted rules into those pages and link Designs only as rationale (C-012-7 to C-012-10). Pages that rely on a rule link its clause or paragraph ID next to the relying sentence; propose explicit constitution amendments when a feature changes a project-wide rule, recording its reason, sources, and impact.
Do not depend on a NiceEval checkout, workspace package, provider credential, deployment service, or global installation.

Keep contracts, executable test definitions, and engineering memories in their own owners. Derive reverse relations; do not store a second registry. Do not claim command receipts prove native test coverage or NiceEval formal E2E reliability.

Contract prose declares intended behavior, constraints, and acceptance; product workflows belong in contracts. Keep development logs, investigation history, and delivery progress in Memory. Use Concord tools for Memory and Issue indexing, recall, reading, creation, author updates, relations, and lifecycle changes; do not directly read or edit their owner files or maintain a manual INDEX. Read `concord --skill memory` or `concord --skill feedback` for the current workflow.

Structured terminology and writing policy are owned by directory-scoped `concepts.md` and `concord-writing.json` under docs. Use Concord tools to maintain these owners; derive the project glossary and references instead of duplicating definitions in Markdown or a second index. Each concept has one term, with its definition and explanation together in concepts.md. Only deprecated names generate terminology bans.

Effect dependencies stay on the exact pinned revision. Read the installed `effect/AGENTS.md` before using its APIs. Use strict Schema decoding at untrusted boundaries and named failures.

Maintain implementation, tests, and build scripts in strict TypeScript with Effect for execution and side effects. Do not add hand-maintained JavaScript scripts or bypass type checking. JavaScript build output and explicit JavaScript-consumer compatibility fixtures are distinct from maintained implementation sources.

The sole native exception is `native/hawdb`: Rust N-API engine bindings, required linker glue, byte conversion, resource budgets, and the revision-bound HawDB directory ownership guard. Keep domain decisions, Schema validation, publication authority, tests, and build orchestration in TypeScript/Effect. Pin the engine revision, Rust toolchain and bridge dependencies. Persistent handles end with the source snapshot, before any owned publication lease; in-memory cache handles belong to the process. Pack target-native artifacts so consumers need no Rust compiler or HawDB service. Engine upgrades must revalidate ownership and clear against the pinned lock protocol.

Use the project-pinned Vite+ toolchain. Bootstrap with `pnpm install --frozen-lockfile`; use `vp install` thereafter. When no global CLI is installed, prefix Vite+ commands with `pnpm exec`, for example `pnpm exec vp build`. Keep the pinned pnpm package manager and lockfile. Run the current source CLI with `pnpm concord`; delivery uses `pnpm check`.

- `vp build` produces the complete distribution through production build hooks, including native bindings, CLI, Web, Preview, and packaged resources. `vp dev` starts only the Web development server.
- `pnpm check` (equivalent to `vp run check`) is the sole check entry: build, parallel type/selfhost checks, then the packed Node and browser suites. Vite+'s built-in `vp check` and `vp test` do not run this project's gate.
- `pnpm check [files...]` accepts `--test-name-pattern=...` and `--test-shard=1/4`. Build and static checks remain complete; selected tests do not replace full acceptance.
- `vp run build:native` reuses validated shared native artifacts, then downloads the matching digest release, then falls back to Cargo. `CONCORD_NATIVE_OFFLINE=1` skips downloads. Release workflows compile from source.
- Test file concurrency defaults to half the available CPUs (maximum eight); browser workers default to at most four. `CONCORD_TEST_CONCURRENCY` and `CONCORD_E2E_WORKERS` explicitly override these values.

Keep task-result caching disabled for acceptance. Do not rebuild the same `dist` while tests or measurements are running; use a separate checkout when concurrent builds are necessary. Preserve one packed artifact per test invocation; consumers share one read-only install per dependency set, and tests that modify installed files request a private copy. See [build and check entrypoints](docs/engineering/concord-self-hosting/README.md#构建与检查入口) for the maintained workflow. Report failed or skipped checks explicitly.

Develop on master. Commit small, scoped hunks and keep no long-lived branches; when a task needs isolation from others' uncommitted work, use a detached worktree based on master, then rebase and fast-forward. Run at most one full `pnpm check` per machine at a time, and re-run timeout or connection-reset failures on an idle machine before attributing them. Follow the shared-resource rules in [testing](docs/engineering/concord-self-hosting/testing.md#共享资源与同步): replace possibly mapped files by rename, give destructive tests private installs, use a new HTTP connection per test request, and wait on real product state rather than elapsed time.

Benchmarks are part of the feature: a budget row in a Feature page and its scenario in `bench/<feature-id>.bench.ts` change together. Before delivering a change that `vp run bench --changed` selects, run `vp run bench --changed --compare` and keep every verdict passing; see [performance](docs/engineering/concord-self-hosting/performance.md#开发与交付流程).

No paid model calls, external mutations, production operations, publishing, or pushing without explicit user authorization.

Workers are not alone in this repository. Preserve other changes, stay within assigned paths, and do not commit unless assigned. Do not use built-in subagents. Herdr delegation follows the user's global guide.
