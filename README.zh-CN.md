# Concord

**把要做的功能，与实现它的代码、测试和决策关联起来。**

[English](README.md) · 简体中文

Concord 是面向开发者和 coding agent 的本地开发工作流工具。产品契约保存在 Markdown 中，实现与测试通过源码注释关联契约，工程经验通过 Memory 保留。CLI 和随包提供的 Web 工作台操作同一份仓库数据。

从契约出发，完成实现与测试，再在审阅改动或排查问题时反查这些关系。核心流程使用项目自己的 Git worktree，不需要账号、模型 API 或云服务。

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
pnpm install --frozen-lockfile
rustup toolchain install 1.97.1 --profile minimal
pnpm build
pnpm concord --help
pnpm check
```

`pnpm check` 构建 CLI 与 Web 工作台，对实现、测试和脚本做类型检查，并执行包括隔离 Git 消费者中打包安装 CLI 在内的测试。查看 Concord 自己的关联，可以运行 `pnpm concord check` 或 `pnpm concord trace show local-sdlc`。

参与开发前请阅读[开发规则](AGENTS.md)与[项目宪法](docs/constitution.md)。Concord 源自 NiceEval 的仓库工作流，运行时保持独立；抽取范围见[来源说明](docs/provenance.md)。
