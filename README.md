# Concord

**把功能契约、实现代码、测试和工程记忆关联起来。**

Concord 是面向开发者与 coding agent 的本地 SDLC CLI。产品契约保存在 Markdown，代码与测试关系写在实际源码旁，Memory 保存问题和裁决历史；Trace 动态反查这些关系，不需要第二份关系 JSON。

Concord 使用项目自己的 Git worktree，不依赖其它产品 checkout、云服务或模型 API。当前支持 Linux/macOS 本地工作树，发行验收覆盖 Ubuntu 24.04 与 Apple Silicon macOS 14/15；需要 Node.js 24.15+、Git，Repository 工具使用 `ripgrep`。发布协调只用 Node 文件 API，不需要 `flock`、`stat`、`diskutil` 或 `plutil`。HawDB 统一承接可重建缓存，安装包自带原生引擎，运行不需要 Rust。源码开发使用 pnpm 11.18.0；Windows 执行与网络多机协调尚未纳入兼容声明。

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
// @concord-file
// @concord-implements docs/feature/greeting/README.md

// @concord-code
// @concord-implements docs/feature/greeting/use-case/greet-name.md
export function greet(name) {
  // @concord-begin
  // @concord-implements docs/feature/greeting/use-case/greet-name.md
  const label = name.trim() || 'world';
  // @concord-end
  return `Hello, ${label}!`;
}
SOURCE

cat > test/greeting.test.mjs <<'TEST'
import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeting.mjs';

// @use-case docs/feature/greeting/use-case/greet-name.md
test('greets a name', () => {
  assert.equal(greet(' Ada '), 'Hello, Ada!');
});
TEST

concord doctor
concord check
concord code list
concord code locate src/greeting.mjs --line 9
concord test list
test_ref="$(concord test list --json | node --input-type=commonjs -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).cases[0].id')"
concord test run "$test_ref" --json
concord trace gaps --json
concord trace show greeting
concord review render greeting
```

预期：`check` 无 findings，发现 **3 条代码声明、1 条测试声明**；第 9 行查询返回文件、函数、代码段三个包含作用域；测试命令通过并生成 `command` 收据。Feature 反查会同时展示其 Use Case 的代码与测试。

打开 `docs/feature/greeting/README.md` 与 `docs/feature/greeting/use-case/greet-name.md` 补写真实产品行为。生成的模板是写作起点；检查通过不表示正文已完成，也不表示产品已被完整测试。

## Web 工作台

在项目根目录启动：

```sh
concord view
# 仅本机访问或自选端口
concord view --host 127.0.0.1 --port 4317
```

默认监听 `0.0.0.0:4317`。打开终端显示的地址即可进入工作台，无需登录或访问密钥。网页随 Concord 安装包分发，无需额外启动前端服务。任何能连接该端口的人都可以编辑仓库并运行配置的测试；明文 HTTP 用于可信网络。

启动时像 Vite 一样列出 `Local` 本机地址和多个 `Network` 网卡地址，同时显示实际 `Host` / `Port`。只绑定 `127.0.0.1` 时不显示局域网入口。

左侧分别进入 Feature、Roadmap、Design、Research、Engineering、代码、测试、运行证据、Memory、反馈、写作与术语、Git 与设置。**Use Case 在所属 Feature 内创建和浏览，没有独立顶级入口。** 文档使用所见即所得 Markdown 编辑器，可切换源码和编辑差异；保存遇到外部修改会保留草稿并报告冲突。

Git 面板按已暂存、未暂存、未跟踪列出文件，支持统一和分栏差异。编辑器中的未保存差异与 Git 变化分别呈现。Web 与 CLI 共用领域校验，空闲网页不会占用仓库锁。

前端使用 React、React Router、Vite、shadcn/ui 和 MDXEditor；Git 差异展示复用 react-diff-view。详细操作见 `concord --skill view`。工作台显示契约、实现和测试关联；高级原生执行通过项目明确接入的能力使用。

## 多来源反馈

Local、GitHub、Linear 在同一列表中呈现。没有外部账号时直接新建本地观察，不需要配置连接：

```sh
concord issue create confusing-output --title "输出含义不清楚"
concord issue index --json
concord issue recall "输出" --json
```

从「反馈」侧栏配置 GitHub 仓库或 Linear team，显式导入 URL 或同步。连接只保存凭据环境变量名，凭据由启动 CLI / Web 服务的环境提供。

```sh
concord feedback connection add --id github-main --provider github --owner OWNER --repo REPO --credential-env GITHUB_TOKEN
concord feedback connection add --id linear-main --provider linear --team TEAM --credential-env LINEAR_API_KEY
concord feedback import https://github.com/OWNER/REPO/issues/123 --connection github-main
concord feedback sync --connection linear-main
concord feedback list --json
concord --skill feedback
```

Linear 首版使用个人 API key。首次成功读取会绑定远端范围身份；同一对象重复导入或清空缓存后不会创建重复反馈。本地笔记、Feature / Memory 关联和关闭状态不会被远端刷新覆盖；远端 Done 不等于本地修复证据。详细命令见[反馈 usage](docs/feature/feedback/cli.md)。

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

`init` 创建静态、不会被执行的 `concord.config.ts`、必需的 `docs/constitution.md`、分类索引、`docs/concord.md` 和 `docs/_template/` 全套模板；根 `DESIGN.md` 可选。它补齐缺失的 `docs/README.md`、`docs/concepts.md`、空 `docs/concepts.json` 和 `docs/architecture.md`，已有根文档保留。它还在根 `AGENTS.md` 新建或刷新一个带边界标记的 Concord-driven development 区块，保留区块外内容，并指向当前安装版本的 `concord --skill`。标记残缺或其它目标冲突时零写入失败。旧 `concord.json`（包括双配置）返回 `ProjectMigrationRequired`，须先显式离线迁移。

改功能前先读取或更新 Feature、叶子 Use Case、CLI supporting page 和必要 Design，再进入实现与测试。运行 `concord trace gaps --json` 可列出没有显式 code/test 关系的 Feature、Use Case 与已建档 CLI 页面；它是关系缺口，不是覆盖率，也不能发现从未建档的命令。

已有 Concord 项目直接维护配置：`sourceRoots` 控制代码扫描，缺省 `[]`；`testRoots: []` 关闭测试发现。两组根可重叠，新增代码功能无需迁移已有测试关系。源码关系在注释里；静态 TypeScript 配置保存目录、runner、模板默认值和本地 Memory 来源，旧 JSON 配置仍可读取。

```sh
concord --dry-run init --docs-only
concord doctor --json
concord template list
concord template show feature --title "Your feature"
concord --skill init
```

`--docs-only` 不能与 `--test-root` 同用。`doctor` 显示缺失目录与关联问题，不执行测试；以后有真实测试再配置 testRoots。

### 文档、Feature、Use Case 与设计

Feature、Roadmap、Design 候选默认只生成必需 README。用 `--pages cli,library` 选择可选页，也可重复 `--pages`。全套为 `--pages library,cli,architecture,lifecycle,use-case`；依赖旧全量默认的脚本须显式选择。Architecture 用于内部边界，Lifecycle 用于资源与状态转换，Use Case 生成索引，具体用户路径单独创建。Web 创建对话框提供相同选择。

Engineering 默认 README 定义目标、机制、使用和验收，用 `engineering page add <id> <topic>` 按需扩展。既有页面保留；新增页面后由作者更新 README 链接。

| 想维护的事实 | contract source / 入口 |
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
concord feature page add greeting cli
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
concord code annotate --scope node \
  --contract docs/feature/greeting/use-case/greet-name.md
concord code annotate --scope file \
  --contract docs/feature/greeting/README.md
concord code annotate --scope region \
  --contract docs/feature/greeting/README.md \
  --contract docs/feature/greeting/use-case/greet-name.md
concord code list --json
concord code locate src/greeting.mjs --line 9 --json
concord --skill code
```

`annotate` 只生成片段，需放入实际源码；重复 `--contract` 表示多目标。文件头用 `@concord-file`，函数/声明前用 `@concord-code`，连续完整语句用成对的 `@concord-begin/end`；范围标记均不带 ID，起始标记后紧跟一条或多条 `@concord-implements`。

首版支持 JS/TS 的有函数体的函数、方法、类，以及单标识符直接绑定的 arrow/function 变量。Region 必须在同一语句列表内，不能截断表达式、跨函数或嵌套 region。文件、函数、代码段可以完整包含，位置查询返回所有包含作用域，不推断继承或优先级。

内部引用由源路径、范围和 AST 位置自动派生，行号随源码重新计算，无需手工命名。目标使用 canonical Feature / Use Case / Engineering 路径，也支持 Feature 或 Engineering supporting page 与有效 `#anchor`。检查会发现重复引用、缺失目标、错误边界及真实标注文件的语法错误；字符串、模板、正则或 JSX 伪标记不注册声明。详见[代码声明](skills/concord/references/code.md)。

### 测试关联与执行

```sh
concord test annotate --contract docs/feature/greeting/use-case/greet-name.md
concord test list
concord test show <derived-reference>
concord test run <derived-reference> --json
concord test evidence ccev_REPLACE_WITH_RECEIPT_ID
concord --skill test
```

把 `@feature` 或 `@use-case` 标记放进测试文件。`//`、`#` 和 `--` 都是标记。关联历史问题时加 `@regression docs/memory/<problem-id>.md`。通用测试用 `@status retired` 退役关联；Repository profile 还支持 `@issue` 和 helper 的 `@test-file`，那是另一套注释解析。测试 ID 由文件和标记派生 `neref_...`，无需人工分配或测试关系 JSON。没有 `@name` 时不按测试标题选择用例。

默认 runner 使用 Node 原生测试，运行标记所在文件。索引不解析宿主测试语法，也不从 `test.skip` / `test.todo` 推断跳过；`@status retired` 不能作为 fixed 证据。其它 runner 在项目配置（仅 `concord.config.ts`，旧 JSON 须先离线迁移）设置 `runner`，初始化时也可用 `--runner-config <file>`。例如已有 Vitest 消费项目可以配置：

```json
{
  "kind": "command",
  "argv": ["pnpm", "exec", "vitest", "run", "{file}", "--testNamePattern", "{pattern}"],
  "sourceFiles": ["package.json", "vitest.config.ts"],
  "timeoutMs": 120000
}
```

这是 runner 对象，不是完整项目配置；对应工具和 sourceFiles 必须存在于消费项目中。`{file}`、`{name}`、`{pattern}` 各占一个完整参数，执行不经过 shell。command 收据记录显式命令及摘要，不证明每个原生 case 实际执行或完整覆盖。

### Memory、问题关闭与本地 Issue

```sh
concord memory add blank-name --kind problem --title "Blank name handling is wrong"
concord memory index --json
concord memory recall "Blank name" --json
concord memory show blank-name
concord issue create greeting-observation --title "Investigate greeting behavior"
concord issue link greeting-observation --memory memory/blank-name.md
```

Agent 通过工具读取和维护 Memory/Issue，不直接编辑 owner 或人工 INDEX。正文更新用 `memory edit` / `issue edit --body <file> --expected-digest <digest>`；动态索引与 recall 返回当前内容和摘要。仅无来源、无关系、无历史的本地草稿可用 `issue remove --expected-digest <digest>` 删除，已进入调查的记录保留生命周期。

用真实测试复现问题，并在测试旁添加 `@regression memory/blank-name.md`。修复前运行 `test run` 取得 red，修复实现后再运行取得 green；用输出里的真实 ID 关闭问题：

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

Trace 从当前 contract source 推导反向关系，分别展示代码声明、测试和 Memory；`check`、`doctor`、`trace` 和 `review` 不执行 runner。代码标注错误会阻断代码与全图命令，但测试执行及 Problem 关闭保留原有文档、测试与证据校验。

文档写作检查使用 `concord docs check --json`。消费者在 docs 下按目录声明 `concepts.json` 和 `concord-writing.json`：根目录拥有全局定义，Feature、Engineering 及子目录拥有局部范围。Web 提供概念与政策编辑和自动汇总；允许别名与弃用名称分开，只有后者派生禁词。写作 v2 支持句段长度、概念使用检查，旧 v1 须显式迁移。规则与用法见[文档写作契约](docs/feature/documentation-quality/README.md)。命中时返回非零退出码，不改写正文。

代码声明解析可按文件重建缓存；关系边每次用当前 Markdown 重算。HawDB 只缓存可重建投影，损坏或失效时回源。实际路径用 `cache status` 查询，普通 checkout 通常为 `.git/concord/cache.hawdb`，不是项目根下的 `.concord`。收据与 journal 位于独立 Git-private 文件中，不能作为缓存删除。克隆后历史裁决保留，缺失的私有证据显示不可用。

文档、代码解析和 Git 测试基线的短期缓存同样使用有界 HawDB 内存实例。`cache clear` 取得数据库所有权后清数据，保留目录和锁 inode；旧 `cache.sqlite` 及其 sidecar 只在显式 clear 时移除。缓存不可用不授权删除锁，也不触发远端刷新。

写入使用锁、preimage 与 journal；中断后根据提示运行 `recover`。外部编辑冲突不会被覆盖，清缓存不能修复错误注释或替代事务恢复。

## Concord 自举

本项目的 `concord.config.ts` 已配置 `sourceRoots: ["src", "web"]` 与真实测试根 `test`。实现文件和关键函数直接关联八条 [本地 SDLC Use Case](docs/feature/local-sdlc/use-case/README.md) 和新增的 [Web 工作台 Use Case](docs/feature/web-workbench/use-case/use-web-workbench.md)。共享基础模块关联 Feature，具体行为关联 Use Case；工作台前端、后端、安装包和真实浏览器测试也使用这套关系。

在 Concord checkout 中运行：

```sh
pnpm build
pnpm concord check
pnpm concord code list
pnpm concord trace show resolve-with-command-evidence
pnpm concord trace show recover-local-state
pnpm concord review render local-sdlc
pnpm check
```

`test/selfhost.test.ts` 在隔离 Git 消费者中核对每条 Use Case 都有真实测试与实现关联，并验证三种 scope。`pnpm check` 执行严格类型检查、领域与恢复测试，再打包安装到临时消费者验证公开 CLI；源码关联不被转换为完成状态或测试覆盖率。

## 安装与本地开发

新代码声明功能使用本 checkout 的构建产物；发行渠道的固定版本可能不同，用 `concord code --help` 核对入口。源码构建需要 Node.js 24.15+、pnpm 11.18.0、Git、Rust 1.97.1 与本机 C 链接工具链。原生构建使用固定 HawDB revision 和 Cargo lock；安装后的消费者不需要这些构建工具。首次取得源码：

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile
rustup toolchain install 1.97.1 --profile minimal
pnpm build
pnpm check
```

Nix 开发环境可用 `nix shell nixpkgs#gcc nixpkgs#pkg-config -c pnpm check` 提供构建工具。该本机构建带 Nix 链接依赖，只用于本地验收；发行流水线分别构建 Linux x64/glibc 和 macOS arm64，再汇入同一个 tgz 验证，不能把本机产物直接当通用发行包。

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

Linux 与 Apple Silicon macOS 14/15 可以从 Homebrew tap 安装。Formula 提供 Node、Git 和 `ripgrep`；0.6.0 的发布协调不再需要 `util-linux` flock：

```sh
brew install CorrectRoadH/tap/concord
```


从这个仓库构建本地安装包，再安装到独立工具目录：

```sh
cd /path/to/Concord
pnpm install --frozen-lockfile
pnpm build
npm pack --ignore-scripts
npm install --prefix ~/.local/share/concord ./concord-sdlc-0.6.0.tgz
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

### 发版

源仓库使用 `concord-v<package.version>` annotated tag。一台 Ubuntu 24.04 runner 校验版本、运行完整检查、构建一次平台无关的 npm tgz，并从该精确资产隔离安装后才创建 GitHub Release；目标平台的可选原生依赖由 npm 在安装时选择。公开 tap 定时或手动发现新 Release，严格核对版本与摘要，验证候选 Formula/Nix 后更新渠道。定时发现可能延迟；失败时使用 tap 的手动 workflow 重跑相同身份，不移动 tag 或覆盖资产。

### Nix / NixOS

公开 Nix 发行入口与 Brew 共用同一份固定版本 Release，支持 Linux x86_64 和 aarch64：

```sh
nix run 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord' -- --help
nix profile install 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord'
```

Nix 自动提供 Node.js 与 Git；仓库专用的 pnpm 等工具仍由消费环境管理。
[NixOS 配置与发行说明](https://github.com/CorrectRoadH/homebrew-tap#nix--nixos)包含系统配置入口。
项目的执行入口继续选择仓库锁定版本，Nix 安装不会重写项目数据。

## 高级测试治理

`concord repo` 管理声明式套件、原生 inventory、回归关系和可靠性证据。项目按 Concord 的中立治理规范接入，拥有自己的 runner、运行环境和调度策略；不要求 Nx、产品包名或固定测试目录。

```sh
concord --skill repository
concord repo --help
```

原生能力按需加载，静态关系与 Web 不执行 host。Problem 已采用的可靠性要求不能用 command 收据绕过。配置、证据与离线迁移契约见[高级测试治理](docs/repository-profile.md)。产品 Preview、示例同步、部署和专属 PR 工具由消费项目维护。

## 更多资料

- [架构与行为契约](docs/architecture.md)
- [独立化设计](docs/design.md)
- [来源与抽取边界](docs/provenance.md)
- [Agent 工作入口](docs/agent-workflow.md)
- [代码声明使用细节](skills/concord/references/code.md)
- [开发规则](AGENTS.md)
