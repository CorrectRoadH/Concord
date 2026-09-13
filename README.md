# Concord

**把功能契约、实现代码、测试和工程记忆关联起来。**

Concord 是面向开发者与 coding agent 的本地 SDLC CLI。产品契约保存在 Markdown，代码与测试关系写在实际源码旁，Memory 保存问题和裁决历史；Trace 动态反查这些关系，不需要第二份关系 JSON。

通用模式使用项目自己的 Git worktree，不依赖 NiceEval、云服务或模型 API。当前支持 Linux 本地文件系统与 Node.js 24.15+；源码开发使用 pnpm 11.18.0。

- [Quick start](#quick-start)：从空仓库跑通契约、代码、测试和反查。
- [常用 usage](#常用-usage)：接入已有项目、维护文档、关联代码、测试与 Memory。
- [Concord 自举](#concord-自举)：在本项目查看真实关系。
- [安装与本地开发](#安装与本地开发)：当前 checkout 全局链接、打包安装和发行入口。
- Agent 按需入口：`concord --skill`，例如 `concord --skill code`。

## Quick start

先按下方[安装说明](#安装与本地开发)安装当前 checkout，并确认 `concord code --help` 可用。以下命令在一个新的演示目录运行，不需要额外测试依赖：

```sh
mkdir concord-demo
cd concord-demo
git init -q
concord init --source-root src --test-root test
concord feature create greeting --title "Greeting"
concord use-case create greet-name --feature greeting --title "Greet a name"
mkdir -p src test

cat > src/greeting.mjs <<'SOURCE'
// @concord-file greeting-module
// @concord-implements docs/feature/greeting/README.md

// @concord-code greet-name
// @concord-implements docs/feature/greeting/use-case/greet-name.md
export function greet(name) {
  // @concord-begin normalize-name
  // @concord-implements docs/feature/greeting/use-case/greet-name.md
  const label = name.trim() || 'world';
  // @concord-end normalize-name
  return `Hello, ${label}!`;
}
SOURCE

cat > test/greeting.test.mjs <<'TEST'
import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeting.mjs';

// @concord-case greeting-happy-path
// @concord-contract docs/feature/greeting/use-case/greet-name.md
test('greets a name', () => {
  assert.equal(greet(' Ada '), 'Hello, Ada!');
});
TEST

concord doctor
concord check
concord code list
concord code locate src/greeting.mjs --line 9
concord test list
concord test run greeting-happy-path --json
concord trace show greeting
concord review render greeting
```

预期：`check` 无 findings，发现 **3 条代码声明、1 条测试声明**；第 9 行查询返回文件、函数、代码段三个包含作用域；测试命令通过并生成 `command` 收据。Feature 反查会同时展示其 Use Case 的代码与测试。

打开 `docs/feature/greeting/README.md` 与 `docs/feature/greeting/use-case/greet-name.md` 补写真实产品行为。生成的模板是写作起点；检查通过不表示正文已完成，也不表示产品已被完整测试。

## 常用 usage

默认输出供人阅读；脚本和 AI 使用 `--json`，跨目录使用 `--root /path/to/project`。先用 `concord <command> --help` 查看精确参数。

### 接入已有项目或纯文档仓库

在 Git worktree 顶层选一种初始化方式，不要在同一项目重复 init：

```sh
concord init --source-root src --test-root test --test-root e2e
# 没有测试时：
concord init --docs-only
# 没有测试，但需要代码归属时：
concord init --docs-only --source-root src
```

`init` 创建 `concord.json`、分类索引、`docs/concord.md` 和 `docs/_template/` 全套模板，保留已有 `docs/README.md`。其它目标冲突时零写入失败；已有文档仓库应先在隔离分支/工作目录审阅迁移，不覆盖原文档。

已有 Concord 项目直接维护配置：`sourceRoots` 控制代码扫描，缺省 `[]`；`testRoots: []` 关闭测试发现。两组根可重叠，新增代码功能无需迁移已有测试关系。源码关系在注释里；JSON 只保存目录和 runner 等机械配置。

```sh
concord --dry-run init --docs-only
concord doctor --json
concord template list
concord template show feature --title "Your feature"
concord --skill init
```

`--docs-only` 不能与 `--test-root` 同用。`doctor` 显示缺失目录与关联问题，不执行测试；以后有真实测试再配置 testRoots。

### 文档、Feature、Use Case 与设计

| 想维护的事实 | owner / 入口 |
|---|---|
| 已采用的产品目标 | `feature create/list/show` |
| 一个功能下的具体用户路径 | `use-case create/list/show` |
| 尚未采用的已定稿方向 | `roadmap create`，采用时 `roadmap adopt` |
| 多方案比较与正式选择 | `design create`，裁决时 `design decide` |
| 仓库测试、维护机制 | `engineering create/list/show` |
| 带日期与来源的外部研究 | `research create/list/show` |
| 问题、决策与可复用经验 | `memory add/list/show/search` |
| 本地观察草稿 | `issue draft/list/show` |

下面以 quick start 创建的 greeting 功能为例：

```sh
concord feature show greeting
concord use-case list
concord feature page show greeting cli --json
concord feature page add greeting migration
concord engineering create ci --title "Continuous integration"
concord design create greeting-format --title "Greeting format" \
  --alternative plain --alternative localized
concord design decide greeting-format --selected plain \
  --target docs/feature/greeting/README.md --reason "Plain text satisfies the current contract"
concord roadmap create greeting-locale --title "Localized greetings"
concord roadmap adopt greeting-locale --feature localized-greeting
```

Feature、Roadmap 和每个 Design 候选会生成 README、library、cli、architecture、lifecycle 与 use-case 结构。`--body <file>` 提供作者正文，`--body -` 从 stdin 读取。Design 的 `DECISION.md` 可补写分析，正式裁决由 `design decide` 保存。

更新已有正文时，先读取最新 digest，再用 `--expected-digest` 防止覆盖并发修改。以下 digest 是需要替换的占位符：

```sh
concord feature page show greeting cli --json
concord feature page set greeting cli --body ./greeting-cli.md \
  --expected-digest 'sha256:REPLACE_WITH_CURRENT_PAGE_DIGEST'
concord author set docs/feature/greeting/README.md --body ./greeting.md \
  --expected-digest 'sha256:REPLACE_WITH_CURRENT_DOCUMENT_DIGEST'
concord --skill document
```

### 文件、函数和代码段属于哪个功能

```sh
concord code annotate validate-name --scope node \
  --contract docs/feature/greeting/use-case/greet-name.md
concord code annotate name-module --scope file \
  --contract docs/feature/greeting/README.md
concord code annotate format-name --scope region \
  --contract docs/feature/greeting/README.md \
  --contract docs/feature/greeting/use-case/greet-name.md
concord code show greet-name
concord code locate src/greeting.mjs --line 9 --json
concord --skill code
```

`annotate` 只生成片段，需放入实际源码；重复 `--contract` 表示多目标。文件头用 `@concord-file`，函数/声明前用 `@concord-code`，连续完整语句用同 ID 的 `@concord-begin/end`；起始标记后紧跟一条或多条 `@concord-implements`。

首版支持 JS/TS 的有函数体的函数、方法、类，以及单标识符直接绑定的 arrow/function 变量。Region 必须在同一语句列表内，不能截断表达式、跨函数或嵌套 region。文件、函数、代码段可以完整包含，位置查询返回所有包含作用域，不推断继承或优先级。

代码 ID 在当前 code 集合唯一，行号随源码重新计算；目标使用 canonical Feature / Use Case 路径，也支持 Feature supporting page 与有效 `#anchor`。引用检查会发现重复 ID、缺失目标、错误边界及真实标注文件的语法错误。源码中的字符串、模板、正则或 JSX 伪标记不注册声明。详见[代码声明指引](skills/concord/references/code.md)。

### 测试关联与执行

```sh
concord test annotate greeting-fallback \
  --contract docs/feature/greeting/use-case/greet-name.md
concord test list
concord test show greeting-happy-path
concord test run greeting-happy-path --json
concord test evidence ccev_REPLACE_WITH_RECEIPT_ID
concord --skill test
```

把生成的 `@concord-case` 与 `@concord-contract` 注释放在真实测试声明正上方，关联历史问题时加 `@concord-regression memory/<problem-id>.md`。无需测试关系 JSON。代码 ID 与测试 case ID 分属独立命名空间。

默认 runner 使用 Node 原生测试。索引支持 `node:test`、Vitest、Playwright 的直接 import 绑定、顶层字面量测试名和静态 callback；已知 skip/todo 不能作为 fixed 证据。其它 runner 在 `concord.json` 设置 `runner`，初始化时也可用 `--runner-config <file>`。例如已有 Vitest 消费项目可以配置：

```json
{
  "kind": "command",
  "argv": ["pnpm", "exec", "vitest", "run", "{file}", "--testNamePattern", "{pattern}"],
  "sourceFiles": ["package.json", "vitest.config.ts"],
  "timeoutMs": 120000
}
```

这是 runner 对象，不是完整 concord.json；对应工具和 sourceFiles 必须存在于消费项目中。`{file}`、`{name}`、`{pattern}` 各占一个完整参数，执行不经过 shell。command 收据记录显式命令及摘要，不证明每个原生 case 实际执行或完整覆盖。

### Memory、问题关闭与本地 Issue

```sh
concord memory add blank-name --kind problem --title "Blank name handling is wrong"
concord memory search "Blank name"
concord memory show blank-name
concord issue draft greeting-observation --title "Investigate greeting behavior"
concord issue link greeting-observation --memory memory/blank-name.md
```

用真实测试复现问题，并在测试旁添加 `@concord-regression memory/blank-name.md`。修复前运行 `test run` 取得 red，修复实现后再运行取得 green；用输出里的真实 ID 关闭问题：

```sh
concord memory resolve blank-name --kind fixed \
  --red ccev_REPLACE_WITH_RED_ID --green ccev_REPLACE_WITH_GREEN_ID \
  --reason "Explain the root cause and the correction"
concord memory reopen blank-name --reason "The problem recurred"
concord --skill memory
```

fixed 校验当前测试定义、契约、Problem epoch 和 green 候选摘要；陈旧或伪造收据会被拒绝。其它裁决使用 `--kind not-a-bug|wont-fix|external-fixed` 与具体理由；Decision/Insight 可用 `supersede` 记录替代，`promote`/`retire` 维护与正式契约的关系。Issue 是本地草稿，`issue close --reason ...` 不操作远端 GitHub。

### Trace、审阅、缓存和恢复

```sh
concord check --json
concord trace check --json
concord trace show greeting --json
concord review render greeting
concord cache status
concord cache clear
concord cache rebuild
concord recover
concord --skill trace
concord --skill recovery
```

Trace 从当前 owner 推导反向关系，分别展示代码声明、测试和 Memory；`check`、`doctor`、`trace` 和 `review` 不执行 runner。代码标注错误会阻断代码与全图命令，但测试执行及 Problem 关闭保留原有文档、测试与证据校验。

代码关系每次回源扫描；SQLite 只缓存可重建的测试投影，损坏或失效时回源。实际路径用 `cache status` 查询，普通 checkout 通常为 `.git/concord/cache.sqlite`，不是项目根下的 `.concord`。收据与 journal 位于独立 Git-private 文件中，不能作为缓存删除。克隆后历史裁决保留，缺失的私有证据显示不可用。

写入使用锁、preimage 与 journal；中断后根据提示运行 `recover`。外部编辑冲突不会被覆盖，清缓存不能修复错误注释或替代事务恢复。

## Concord 自举

本项目的 `concord.json` 已配置 `sourceRoots: ["src"]` 与真实测试根 `test`。实现文件和关键函数直接关联八条 [Use Case](docs/feature/local-sdlc/use-case/README.md)：初始化、契约维护、测试索引、代码索引、命令证据、恢复、Trace、repository profile 入口。共享基础模块关联本地 SDLC Feature，具体行为关联 Use Case。

在 Concord checkout 中运行：

```sh
pnpm build
pnpm concord check
pnpm concord code list
pnpm concord code show verify-fixed-command-proof
pnpm concord trace show resolve-with-command-evidence
pnpm concord trace show recover-local-state
pnpm concord review render local-sdlc
pnpm check
```

`test/selfhost.test.ts` 在隔离 Git 消费者中核对每条 Use Case 都有真实测试与实现关联，并验证三种 scope。`pnpm check` 执行严格类型检查、领域与恢复测试，再打包安装到临时消费者验证公开 CLI；源码关联不被转换为完成状态或测试覆盖率。

## 安装与本地开发

新代码声明功能使用本 checkout 的构建产物；发行渠道的固定版本可能不同，用 `concord code --help` 核对入口。源码构建需要 Node.js 24.15+、pnpm 11.18.0 和 Git。首次取得源码：

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

本机开发与 dogfooding 使用全局链接，直接运行当前 checkout 的构建产物：

```sh
cd /path/to/Concord
pnpm install --frozen-lockfile
pnpm build
npm install --global --prefix "$HOME/.local" --ignore-scripts --no-audit --no-fund "$PWD"
export PATH="$HOME/.local/bin:$PATH"
concord --version
readlink -f "$(command -v concord)"
```

本地目录安装会创建包与 bin 的符号链接；修改源码后运行 `pnpm build` 即生效，无需重新安装。移动 checkout 后需要重新链接。若先前使用 Nix 用户 profile 安装 Concord，先用 `nix profile remove concord` 移除旧入口。全局链接供日常自举，`pnpm check` 仍构建、打包并在隔离消费者中安装验收。

Linux 可以从 Homebrew tap 安装：

```sh
brew install CorrectRoadH/tap/concord
```


从这个仓库构建本地安装包，再安装到独立工具目录：

```sh
cd /path/to/Concord
pnpm install --frozen-lockfile
pnpm build
npm pack --ignore-scripts
npm install --prefix ~/.local/share/concord ./concord-sdlc-0.3.0.tgz
export PATH="$HOME/.local/share/concord/node_modules/.bin:$PATH"
concord --help
```

Agent 可直接从已安装包读取精简入口，不需要另行全局安装 skill，也不要求当前目录已初始化：

```sh
concord --skill
concord --skill test
concord --skill all
```

无 topic 时输出按需路由的 `SKILL.md`；已知 topic 输出对应详细命令，`all` 仅用于需要完整离线资料时。skill 读取不会加载消费仓库或 repository profile，也不会写文件。

包附带 `npm-shrinkwrap.json`，锁定 Effect 预发布版本及传递依赖。源码开发用 `pnpm-lock.yaml`；升级依赖时同时更新两者并重新做安装验收。

### Nix / NixOS

公开 Nix 发行入口与 Brew 共用同一份固定版本 Release，支持 Linux x86_64 和 aarch64：

```sh
nix run 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord' -- --help
nix profile install 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord'
```

Nix 自动提供 Node.js 与 Git；仓库专用的 pnpm 等工具仍由消费环境管理。
[NixOS 配置与发行说明](https://github.com/CorrectRoadH/homebrew-tap#nix--nixos)包含系统配置入口。
NiceEval 的 `pnpm run repo` 等命令继续选择仓库锁定版本，Nix 安装不会重写项目数据。

## Repository profile

`concord repo` 承接 NiceEval 仓库维护命令，通过消费仓库的 host 提供原生 inventory 与 formal evidence。项目内继续使用锁定版本的 `pnpm run repo …` 等入口；global engine 与仓库锁定字节不一致时会拒绝执行。它与通用模式的 command 收据保持独立，不要求其它项目接入 NiceEval。

```sh
concord --skill repository
concord repo --help
```

[Repository profile](docs/repository-profile.md) 说明源码注释、历史归档、v2 证据及既有历史读取边界。

## 更多资料

- [架构与行为契约](docs/architecture.md)
- [独立化设计](docs/design.md)
- [来源与抽取边界](docs/provenance.md)
- [Agent 工作入口](docs/agent-workflow.md)
- [代码声明使用细节](skills/concord/references/code.md)
- [开发规则](AGENTS.md)
