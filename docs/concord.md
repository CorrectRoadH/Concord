# Developing with Concord

Concord connects current product contracts, real test declarations, and engineering memory.

先运行 `concord --skill` 读取短入口，再按任务运行 `concord --skill <topic>`；完整离线资料使用 `concord --skill all`。

## 本仓库的自举用法

Concord 用当前 checkout 构建并 link 的公开 CLI 维护自身契约。当前入口应报告与 `package.json` 一致的版本，项目 runner 固定为：

```text
node --import tsx --test --test-name-pattern {pattern} {file}
```

维护文档时先阅读 [本地 SDLC 闭环](feature/local-sdlc/README.md) 与 [Concord 自举维护](engineering/concord-self-hosting/README.md)。新增或调整测试时，在测试文件里放置 `@feature <canonical path>` 或 `@use-case <canonical path>`；可附加 `@regression` 和 `@status`。标记存在即构成关联，不要求特定测试声明形状。本仓库 runner 仍是上面的 `node:test` 命令，文件需要能被该命令执行。测试 ID 由文件和标记派生，不人工分配。测试回调通过 `Effect.runPromise` 执行 `Effect.sync` 或现有 Effect program。

日常自举检查使用：

```text
concord doctor
concord check
concord test list
concord trace check
concord trace show local-sdlc
concord review render local-sdlc
```

这些只读关系检查不执行 runner；只有显式 `concord test run <case-id>` 才产生 command evidence。最终仓库质量门仍是 `pnpm check`。command evidence 不是 NiceEval formal E2E，也不是逐测试覆盖率证明；repository profile 的 host、engine 与 formal proof 规则见对应 [Use Case](feature/local-sdlc/use-case/load-compatible-repository-profile.md)。

## Connect implementation to contracts

Configure sourceRoots in concord.config.ts, or initialize with --source-root src (repeatable). Run concord --skill code for file, function and statement-region declarations. Use code annotate to generate comments, code locate <path> --line <n> to inspect all containing scopes, and trace show to reverse-query the contract. Code declarations describe implementation associations, not completion or test coverage.

## Choose the document that owns your intent

- [Feature](feature/README.md): the adopted product contract, even when implementation is still catching up.
- [Roadmap](roadmap/README.md): a settled direction awaiting adoption.
- [Design](design/README.md): goals, constraints, self-contained alternatives, and the reason for a decision.
- [Engineering](engineering/README.md): how this repository is tested and maintained.
- [Research](research/README.md): dated external facts and sources.
- [Memory](../memory/README.md): problems, decisions, and reusable lessons with their history.
- [Issues](issues/README.md): local observations awaiting investigation.

契约正文声明目标、行为、约束与验收条件；产品流程属于契约。开发日志、排障经过与实施进度归工程 Memory，待调查观察归 Issue。
Templates provide writing prompts, not completed requirements or evidence.

## Complete setup

Init installs every category, the documentation entry point, and the complete [template reference set](_template/README.md).
Feature, Roadmap, and each Design candidate require README. Select optional pages with --pages library,cli,architecture,lifecycle,use-case, or repeat --pages; omission uses project defaults; --no-pages explicitly creates README only. Design decision wrapper pages are always created. Engineering starts with README and expands by topic.
Page add adds optional or custom topic pages. Maintain README links after adding pages.

## Project constitution

Read [the current constitution](constitution.md) before planning, implementing, or reviewing a feature. Feature and Design owners cite applicable clause anchors through constitutionRefs. Use `concord constitution show` to inspect the current body, digest, and affected owners; explicit adopt/amend operations record the reason, sources, and impact. Draft templates do not assert compliance.

## First feature

```
concord feature create login --title "Login"
concord use-case create expired-token --feature login --title "Reject expired tokens"
```

Fill in the generated author prose. Use `concord template list` and `concord template show feature` to inspect bundled templates.
`--body <file>` supplies your own prose; `--body -` reads stdin.
`page show` returns the current digest; `page set --expected-digest` checks it before replacing a page.
Lifecycle metadata remains owned by the corresponding Concord commands.

## Connect a real test

Place `// @use-case docs/feature/login/use-case/expired-token.md` in the test file. `//`, `#`, and `--` are markers. Concord derives the execution reference from the file and marker; no manual ID or attach step is needed. The marker is the case; Concord does not parse host test syntax.
Then run `concord check`, `concord test list`, and `concord trace show docs/feature/login/README.md`.
Use `--regression memory/<problem>.md` when a test protects a recorded Problem.
Source annotations are the only contract source of these test relations; reverse lists are derived.

## Configure and run verification

`concord.config.ts` owns testRoots and runner configuration for this repository and new projects; old `concord.json` requires explicit offline migration. Defaults scan test/ and tests/ using Node native tests.
For documentation-only repositories, use `concord init --docs-only` with empty testRoots. Add real test roots later; document integrity is not test coverage.
Use `concord doctor` to inspect the configuration and missing test roots without running repository commands.
For another runner, set runner to an object such as:

```
{"kind":"command","argv":["your-runner","{file}"],"sourceFiles":[],"timeoutMs":60000}
```

Replace the executable and arguments with your repository test command. Each placeholder must occupy one complete argument;
supported placeholders are {file}, {name}, and {pattern}. Arguments never run through a shell.
Include additional assertion or runner configuration files in sourceFiles. Concord does not install your dependencies.
Only `concord test run <id>` executes the runner. Check, trace, template, and doctor do not run tests.

Run results are command evidence, not proof that a native case executed or that a feature is covered.
For a Problem fix, capture a normal failing red command, change the product implementation, then capture green.
Keep the test definition and contract unchanged between both runs. Resolve using both receipt IDs and an explicit reason.
See `concord memory resolve --help`. Use `concord review render` for local review material.

## Working safely

`--dry-run` previews document mutations. Existing files are never overwritten by init or create.
`--json` emits machine-readable results. An empty repository can pass integrity checks without having tests.
Private evidence is per Git worktree and is not copied by a normal clone; missing historical evidence remains unavailable.
Use `concord recover` for an interrupted publication and `concord cache rebuild` for disposable cache repair.

## 工具维护工程知识

Memory 使用 `concord memory index/recall` 获取索引和正文，Issue 使用 `concord issue index/recall`。创建和修改使用 add/create、edit 或 author set；状态与关系使用具名生命周期命令。Agent 不直接读写受管 Memory/Issue 文件，不手工维护 INDEX.md 或关系登记表。参见 [工具式记忆维护](feature/local-sdlc/use-case/recall-and-maintain-memory.md)。

Local、GitHub、Linear 统一作为反馈来源。Local 无需连接即可用 `concord issue create` 创建观察；远端接入只负责读取，其本地笔记和状态由本地工具维护。参见 [本地观察](feature/feedback/use-case/manage-local-observations.md)。

## Scoped terminology and writing

Use Concord concepts and writing tools for scoped JSON owners under docs. The directory owns the scope; docs/concepts.json contains global definitions, while Feature/Engineering subdirectories own local concepts.json and concord-writing.json. The Web workbench aggregates sources without copying them. Markdown explains relationships and examples; only explicit deprecated names produce terminology bans. See [policy and migration](feature/documentation-quality/policy.md).
