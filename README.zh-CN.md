# Concord

**以 Spec 驱动开发：人审阅 Spec，agent 按 Spec 实现并用测试证明，Concord 检查三者是否一致。**

[English](README.md) · 简体中文

Concord 是面向开发者和 coding agent 的本地 Spec 驱动开发工具。Spec 是软件必须做什么的唯一事实来源。人审阅 Spec 的变化；agent 按 Spec 实现，并用测试证明；Concord 检查 Spec、实现与测试是否仍然一致。CLI 和随包提供的 Web 工作台操作同一份仓库文件。

所有内容都是 Git worktree 中的普通文件，人和 agent 直接编辑全部文件。Concord 命令执行变化需要运行的步骤，例如修复核验。CI 中的 `concord check --since <base>` 检查每次变化是否合法。核心流程不需要账号、模型 API 或云服务。

## 解决什么问题

一个软件项目里，"要做什么"、"怎么做的"和"为什么这样做"通常散在不同地方。需求在聊天记录和 PR 描述里，设计取舍在某个人的记忆里，测试声称保护某个功能，但没人能确认它保护的是哪一条行为。

和 coding agent 一起开发时，这个问题更明显：每次对话都从零开始，agent 会重新决定已经定过的语义，用不同的词指同一件事，或者在没有证据时宣布问题已修复。审阅几千行生成的代码，也比审阅背后几句意图难得多。

Concord 把审阅移到 Spec 上。Spec 是仓库中的 Markdown，代码与测试用源码标记指向 Spec，反向关系由工具从源码推导。审阅者读 Spec 怎样变化，`concord check` 检查实现、测试与记录是否仍与 Spec 一致。

## 仓库如何组织

文档按回答的问题分组。位置和唯一的一级标题决定文档的身份、类别与名称；frontmatter 只保存推导不出的事实，例如 Issue 的状态。

| 分组 | 文档 | 回答 |
| --- | --- | --- |
| Spec | `docs/feature/` 下的 Feature；`docs/engineering/` 下仓库自身的维护机制 | 系统现在必须怎样 |
| 提案 | `docs/roadmap/` 下的 Roadmap，写法同 Feature | 尚未采用的方向 |
| 项目规则 | 宪法、术语（`concepts.md`）、写作政策（`concord-writing.json`） | 所有 Feature 共同遵守什么 |
| 决策记录 | `docs/design/` 与 `docs/research/` 下的 Design 与 Research | 为什么这样设计 |
| 工作项 | `docs/issues/` 下的 Issue | 哪里不对、还要做什么 |
| 知识 | `memory/` 下的 Memory | 学到了什么 |

一个 Feature 最多包含四种页面：README 说明能力，Use Case 写用户路径与验收，`architecture.md` 写实现，`cli.md` 或 `library.md` 给出具体调用与输出。位置与字段见[文档模型](docs/document-model.md)。

## 为什么需要这些概念

| 概念 | 解决的问题 |
| --- | --- |
| Feature 与 Use Case | 把产品必须做到的行为写成持久的 Spec，先于实现。Use Case 描述一条用户路径的主流程与验收，给代码和测试一个比"整个功能"更具体的目标。 |
| 行为页与 architecture 页 | README、Use Case 与示例页写使用者看到的结果，architecture 页写怎么实现。行为不变的重构只改 architecture 页，行为页和指向它们的测试保持稳定。 |
| Design | 有多个可行方案时，在共同的目标与约束下比较候选，记录唯一选择和理由。采用的规则写进 Spec，Spec 把裁决链接为决策依据。 |
| Roadmap 与 Research | Roadmap 保存尚未采用的方向，写法同 Feature，采用时移入 `docs/feature/`；Research 保存带日期和来源的外部事实，作为决策输入。 |
| 术语表 | 同一个概念只用一个首选名称，弃用名称会被 `check` 报告。按目录划分作用域，不同 Feature 中的同名概念可以各有定义。agent 按字面理解文字，术语统一了，Spec 才不会被读出两种意思。 |
| 写作政策 | 禁用 `helper`、`resolve` 这类没有说明职责的词，限制句长与段长，并给出替代写法和理由。Spec 写得清楚，实现才不需要猜。 |
| 源码标记 | 实现与测试在源码中声明自己关联哪个 Spec，关系随代码一起出现在 diff 中。反向列表由工具推导，不另外维护登记表，所以不会和代码脱节。 |
| Issue 与修复核验 | 缺陷、请求与观察都是 Issue。修复按提交证明：回归测试在加入它的提交上失败、在修复提交上通过，结论写进 Issue，任何人都可以重放。 |
| Memory | 可复用的知识，以及不需要 Design 的决策。`docs/` 因此只保留当前的声明，不混入开发日志。 |
| 项目宪法 | 记录跨功能、长期有效的规则。页面在依据规则的句子旁引用条款，每次修订记为 Memory 中的一条决策。 |
| 变化门禁 | `concord check --since <base>` 检查一次变化做了什么：状态转换、修复核验、宪法修订与 Design 裁决。CI 对每个变化运行它，直接编辑因此可信。 |

## 可以做什么

- **定义要做的事。** 编写 Feature 与 Use Case，比较设计候选，在实现前记录明确裁决。
- **找到对应实现。** 从 Spec 反查标注过的文件、函数、代码段和测试，反向关系从源码派生。
- **证明修复。** 把缺陷写成 Issue，先提交失败的回归测试，再提交修复，以经过核验、可重放的结论关闭 Issue。
- **结合上下文审阅。** 在 Web 工作台查看 Spec、源码、测试、Issue、反馈与 Git 改动，或通过 CLI 生成本地审阅材料。

Concord 要求 Spec 先于实现，项目的语言、包管理器和测试 runner 由项目自己选择。源码标注表达关联，一次测试运行报告一次执行结果，两者都不代表完整测试覆盖。

## 安装

Linux 或 Apple Silicon macOS 可通过 Homebrew 安装：

```sh
brew install CorrectRoadH/tap/concord
concord --help
```

Linux 也可以使用 Nix：

```sh
nix profile install 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord'
concord --help
```

运行需要 Node.js 24.15+ 和 Git，Repository 工具还使用 `ripgrep`。发行包自带原生缓存引擎，安装使用不需要 Rust 或数据库服务。

发行包的原生目标为 Linux x64/glibc 与 macOS arm64，macOS 最低部署目标为 15。

源码发布必须通过完整测试集和最终归档的冻结生产安装检查；Homebrew 与 Nix 渠道更新另需通过各自的安装检查。

允许在 macOS 27 安装，但尚未由 CI 实测。Windows 执行与网络多机协调不在兼容声明范围内。详见[发行 Spec](docs/feature/cross-platform-release/README.md)。

## 快速上手

在已有 Git 仓库中初始化 Concord：

```sh
concord init
concord new feature greeting --title "Greeting" --pages use-case
concord new use-case greet-name --feature greeting --title "Greet a name"
```

Concord 默认发现 `src/`、`test/` 与 `tests/`，`concord.config.ts` 可以不存在。代码在其它位置时传 `--source-root` 或 `--test-root`，没有测试的仓库用 `--docs-only`。初始化会创建文档模板、项目宪法，并在 `AGENTS.md` 中维护 Agent 指引区块。

`new` 只按模板创建文件，也可以手工创建同样的文件。直接在其中写清目标行为：

```text
docs/feature/greeting/README.md
docs/feature/greeting/use-case/greet-name.md
```

在对应实现声明前紧邻放置注释，关联 Spec：

```ts
// @concord-code
// @concord-implements docs/feature/greeting/use-case/greet-name.md
export function greet(name: string): string {
  return `Hello, ${name.trim() || 'world'}!`;
}
```

在测试根目录内，为测试文件添加相应标注：

```ts
// @use-case docs/feature/greeting/use-case/greet-name.md
```

然后检查并查看关联：

```sh
concord doctor
concord check
concord test list
concord show greeting
```

`check` 校验关系、生命周期规则和项目写作政策，不执行测试。要运行测试声明，把 `concord test list` 返回的 ID 传给 `concord test run <id>`。默认 runner 使用 Node 原生测试；需要其它 runner 时，在 `concord.config.ts` 中配置。详见[测试指引](skills/concord/references/test.md)。

## 修复缺陷

1. 把缺陷写成 Issue：`concord new issue duplicate-sku`，或直接创建 `docs/issues/duplicate-sku.md`。
2. 提交会失败的回归测试，带标记 `@issue docs/issues/duplicate-sku.md`。
3. 提交修复，不改动该测试、runner 配置与测试指向的 Spec。
4. 运行 `concord issue close duplicate-sku --fixed --reason "..."`。Concord 在缺陷提交与 HEAD 上分别运行测试，把核验结论写进 Issue。

`concord test verify duplicate-sku` 重放已记录的核验。CI 中的 `concord check --since <base>` 重放本次变化新增的核验。见[核验修复并关闭缺陷](docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md)。

## 打开 Web 工作台

```sh
concord view
```

打开终端显示的地址即可使用。工作台随安装包分发，提供文档编辑、实现与测试关联、Issue、Memory、反馈、术语和 Git 差异。Use Case 在所属 Feature 内浏览与维护。

省略 `--host` 时，服务监听 `127.0.0.1:4317`。服务没有身份验证，能连接该端口的人可以编辑仓库并运行配置的测试；只在可信网络中传 `--host 0.0.0.0`。

## 与 Agent 一起使用

Agent 可以读取当前安装版本随包提供的指引，无需先初始化仓库：

```sh
concord --skill
concord --skill document
concord --skill code
concord --skill test
concord --skill memory
```

用 `concord <command> --help` 查看精确参数，`--json` 获取结构化结果，`--root /path/to/project` 指定其它工作树。Agent 直接编辑 Spec、Issue 与 Memory；`issue close --fixed`、`design decide`、`roadmap adopt` 等命令执行这些变化需要运行的步骤。

## 深入使用

| 想做的事 | 阅读入口 |
| --- | --- |
| 理解工作流与事实归属 | [为什么需要 Concord](docs/why-concord.md) · [文档模型](docs/document-model.md) · [架构](docs/architecture.md) · [Agent 工作流](docs/agent-workflow.md) |
| 查阅命令与输出 | [CLI](docs/feature/local-sdlc/cli.md) |
| 标注文件、函数和代码段 | [代码指引](skills/concord/references/code.md) |
| 运行测试与核验修复 | [测试指引](skills/concord/references/test.md) |
| 记录可复用的知识 | [Memory 指引](skills/concord/references/memory.md) |
| 将 GitHub、Linear 反馈与本地 Issue 一起查看 | [反馈命令](docs/feature/feedback/cli.md) |
| 确定项目在测试上自己负责什么 | [项目测试接入边界](docs/repository-profile.md) |
| 浏览产品 Spec | [文档目录](docs/README.md) |

链接中的详细指引与 Spec 以中文为主。两份 README 提供内容对应的产品介绍和入门流程。

## 开发 Concord

源码构建需要 Node.js 24.15+、pnpm 11.18.0、Git、Rust 1.97.1 和本机 C 链接工具链。

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile # 安装项目固定版本的 vp
rustup toolchain install 1.97.1 --profile minimal
pnpm exec vp build
pnpm exec vp run concord --help
pnpm exec vp run check
```

`pnpm check`（也可通过 `vp run check` 调用）是唯一的检查入口。它先构建 CLI 与 Web 工作台并复用已校验的原生产物，再并行做 repository、测试和脚本的类型检查以及当前 checkout 的 Spec 检查，最后在隔离 Git 消费者中并发运行打包 CLI 的 Node 与浏览器测试。

运行 `pnpm concord trace show local-sdlc` 可从源码查看关联。

没有全局安装 Vite+ 时使用 `pnpm exec vp`。`vp install` 通过固定版本的 pnpm 管理依赖。

`pnpm check test/writing-cache.test.ts` 在完整构建和静态检查之后只运行指定文件；用 `--test-name-pattern=...` 选择用例，用 `--test-shard=1/4` 对完整测试集分片。只跑部分测试不能代替完整门禁。

`vp run check` 是完整交付门禁。`vp build` 的生产构建钩子准备完整发行产物。Vite+ 内置的 `vp check` 和 `vp test` 不调用项目脚本。测试使用 Node runner，每次调用共享一份打包产物，消费者独立安装。任务缓存关闭；局部检查不替代完整验收。

参与开发前请阅读[开发规则](AGENTS.md)与[项目宪法](docs/constitution.md)。Concord 源自 NiceEval 的仓库工作流，运行时保持独立；抽取范围见[来源说明](docs/provenance.md)。
