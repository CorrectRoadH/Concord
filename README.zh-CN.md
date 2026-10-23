# Concord

**把要做的功能，与实现它的代码、测试和决策关联起来。**

[English](README.md) · 简体中文

Concord 是面向开发者和 coding agent 的本地开发工作流工具。产品契约保存在 Markdown 中，实现与测试通过源码注释关联契约，工程经验通过 Memory 保留。CLI 和随包提供的 Web 工作台操作同一份仓库数据。

从契约出发，完成实现与测试，再在审阅改动或排查问题时反查这些关系。核心流程使用项目自己的 Git worktree，不需要账号、模型 API 或云服务。

## 解决什么问题

一个软件项目里，"要做什么"、"怎么做的"和"为什么这样做"通常散在不同地方。需求在聊天记录和 PR 描述里，设计取舍在某个人的记忆里，测试声称保护某个功能，但没人能确认它保护的是哪一条行为。和 coding agent 一起开发时，这个问题更明显：每次对话都从零开始，agent 会重新决定已经定过的语义，用不同的词指同一件事，或者在没有证据时宣布问题已修复。

Concord 把这三类信息放进同一个 Git 仓库，并维护它们之间的关系。契约写在 Markdown 中，代码与测试用源码标记指向契约，反向关系由工具从源码推导。人和 agent 读写的是同一份数据，`concord check` 检查这些关系是否仍然成立。

## 为什么需要这些概念

| 概念 | 解决的问题 |
| --- | --- |
| Feature 与 Use Case | 把产品必须做到的行为写成持久的契约，先于实现。Feature 描述一项能力；Use Case 描述一条用户路径的主流程与验收，给代码和测试一个比"整个功能"更具体的目标。 |
| Design | 有多个可行方案时，在共同的目标与约束下比较候选，记录唯一选择和理由。后来的人和 agent 能看到为什么选它、为什么没选别的，不会反复重新讨论。 |
| Roadmap 与 Research | Roadmap 保存已经定下但尚未采用的方向；Research 保存带日期和来源的外部事实，作为决策输入，和契约分开。 |
| 术语表 | 同一个概念只用一个首选名称，弃用名称会被 `check` 报告。按目录划分作用域，不同 Feature 中的同名概念可以各有定义。agent 按字面理解文字，术语统一了，契约才不会被读出两种意思。 |
| 写作政策 | 禁用"helper"、"resolve"这类没有说明职责的词，限制句长与段长，并给出替代写法和理由。契约写得清楚，实现才不需要猜。 |
| 源码标记 | 实现与测试在源码中声明自己关联哪个契约，关系随代码一起出现在 diff 中。反向列表由工具推导，不另外维护登记表，所以不会和代码脱节。 |
| 命令收据 | `test run` 记录一次真实执行的结果。关闭一个 Problem 需要同一测试先失败、再通过的两份收据，"已修复"要有证据。 |
| Memory 与 Issue | 排障经过、根因、决策和经验写入 Memory，待调查的观察写入 Issue。`docs/` 因此只保留当前的声明，不混入开发日志。 |
| 项目宪法 | 记录跨功能、长期有效的规则。Feature 与 Design 引用适用的条款，修订时保留理由和影响。 |

## 可以做什么

- **定义要做的事。** 描述 Feature 与 Use Case，比较设计候选，在实现前记录明确裁决。
- **找到对应实现。** 从契约反查标注过的文件、函数、代码段和测试，反向关系从源码派生。
- **保留有用的历史。** 用 Memory 记录问题、决策和经验；使用相匹配的 red / green 执行证据，将问题关闭为 fixed。
- **结合上下文审阅。** 在 Web 工作台查看契约、源码、测试证据、反馈与 Git 改动，或通过 CLI 生成本地审阅材料。

Concord 要求契约先于实现，项目的语言、包管理器和测试 runner 由项目自己选择。源码标注表达关联，命令收据记录执行结果，两者都不代表完整测试覆盖。

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

发行包的原生目标为 Linux x64/glibc 与 macOS arm64，macOS 最低部署目标为 15。自动发布只构建并核验包身份，不运行测试或安装检查；允许在 macOS 27 安装，但尚未由 CI 实测。Windows 执行与网络多机协调不在兼容声明内。详见[发行契约](docs/feature/cross-platform-release/README.md)。

## 快速上手

在已有 Git 仓库中，按实际源码和测试目录初始化：

```sh
concord init --source-root src --test-root test
concord feature create greeting --title "Greeting"
concord use-case create greet-name --feature greeting --title "Greet a name"
```

没有测试的仓库改用 `concord init --docs-only`。初始化会创建 `concord.config.ts`、文档模板、项目宪法，并在 `AGENTS.md` 中维护 Agent 指引区块。

在生成的文档中写清目标行为：

```text
docs/feature/greeting/README.md
docs/feature/greeting/use-case/greet-name.md
```

在对应实现声明前紧邻放置注释，关联契约：

```ts
// @concord-code
// @concord-implements docs/feature/greeting/use-case/greet-name.md
export function greet(name: string): string {
  return `Hello, ${name.trim() || 'world'}!`;
}
```

在配置的测试根目录内，为测试文件添加相应标注：

```ts
// @use-case docs/feature/greeting/use-case/greet-name.md
```

然后检查并查看关联：

```sh
concord doctor
concord check
concord code list
concord test list
concord trace show greeting
```

`check` 校验关系、生命周期规则和项目写作政策，不执行测试。要运行测试声明，把 `concord test list` 返回的 ID 传给 `concord test run <id>`。默认 runner 使用 Node 原生测试；需要其它 runner 时，在 `concord.config.ts` 中配置。详见[测试指引](skills/concord/references/test.md)。

## 打开 Web 工作台

```sh
concord view --host 127.0.0.1
```

打开终端显示的地址即可使用。工作台随安装包分发，提供文档编辑、实现与测试关联、运行证据、Memory、反馈、术语和 Git 差异。Use Case 在所属 Feature 内浏览与维护。

省略 `--host` 时，服务监听 `0.0.0.0:4317`。服务没有身份验证，能连接该端口的人可以编辑仓库并运行配置的测试；这一监听方式仅用于可信网络。

## 与 Agent 一起使用

Agent 可以读取当前安装版本随包提供的指引，无需先初始化仓库：

```sh
concord --skill
concord --skill document
concord --skill code
concord --skill test
concord --skill memory
```

用 `concord <command> --help` 查看精确参数，`--json` 获取结构化结果，`--root /path/to/project` 指定其它工作树。Memory 和 Issue 的正文、历史与生命周期都通过 Concord 命令维护。

## 深入使用

| 想做的事 | 阅读入口 |
| --- | --- |
| 理解工作流与事实归属 | [架构](docs/architecture.md) · [Agent 工作流](docs/agent-workflow.md) |
| 标注文件、函数和代码段 | [代码指引](skills/concord/references/code.md) |
| 执行测试与检查证据 | [测试指引](skills/concord/references/test.md) |
| 记录和关闭工程问题 | [Memory 指引](skills/concord/references/memory.md) |
| 将 GitHub、Linear 反馈与本地观察一起查看 | [反馈命令](docs/feature/feedback/cli.md) |
| 接入原生测试清单与可靠性政策 | [高级测试治理](docs/repository-profile.md) |
| 浏览产品契约 | [文档目录](docs/README.md) |

链接中的详细指引与契约以中文为主。两份 README 提供内容对应的产品介绍和入门流程。

## 开发 Concord

源码构建需要 Node.js 24.15+、pnpm 11.18.0、Git、Rust 1.97.1 和本机 C 链接工具链。

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile # bootstrap the pinned local vp
rustup toolchain install 1.97.1 --profile minimal
pnpm exec vp build
pnpm exec vp run concord --help
pnpm exec vp run check
```

`vp run check`（也可通过 `pnpm check` 调用）构建 CLI 与 Web 工作台，对实现、测试和脚本做类型检查，并执行包括隔离 Git 消费者中打包安装 CLI 在内的测试。查看 Concord 自己的关联，可以运行 `pnpm concord check` 或 `pnpm concord trace show local-sdlc`。


没有全局安装 Vite+ 时使用 `pnpm exec vp`。`vp install` 通过固定版本的 pnpm 管理依赖。`vp run check:fast` 只检查 CLI 与 Web 源码类型，无需构建或运行测试。执行 `vp build` 后，`vp run typecheck:built` 检查 repository、测试和脚本类型；`vp run test:built test/writing-cache.test.ts` 无需重复构建即可运行指定文件。用 `--test-name-pattern=...` 选择用例，用 `--test-shard=1/4` 对完整测试集分片。源码变化后，先重新构建再运行 `:built` 任务。

`vp run check` 是完整交付门禁。`vp build` 的生产构建钩子准备完整发行产物。Vite+ 内置的 `vp check` 和 `vp test` 不调用项目脚本。测试使用 Node runner，每次调用共享一份打包产物，消费者独立安装。任务缓存关闭；局部检查不替代完整验收。

参与开发前请阅读[开发规则](AGENTS.md)与[项目宪法](docs/constitution.md)。Concord 源自 NiceEval 的仓库工作流，运行时保持独立；抽取范围见[来源说明](docs/provenance.md)。
