# Concord

**让功能契约、测试和工程记忆保持一致。**

Concord 是面向开发者与 coding agent 的本地 SDLC 工具。它把“产品应该做什么”“哪些测试保护这个行为”“问题为什么发生、如何解决”连接起来，并把审阅和验收所需的证据放在同一条可追溯路径上。

它从 NiceEval 的仓库工程体系中独立出来，使用消费项目自己的 Git 仓库，不依赖 NiceEval、云服务或模型 API。

## 为什么需要它

功能文档、测试和问题记录通常分散在不同地方。改动一个行为时，很难可靠回答：

- 当前采用的契约在哪里，哪些只是候选方案？
- 这个测试保护的是哪个用户目标？
- 一个历史问题有没有回归保护？
- “已经修复”是人的结论，还是有对应运行证据？
- 换一个开发者、Agent 或分支后，能否找回这些关系？

Concord 用可审阅的源文件保存这些事实，用命令维护生命周期，用本地索引加快查询。

## 核心分工

| 内容 | 唯一归属 |
|---|---|
| 当前采用的产品目标 | Feature / Use Case Markdown |
| 尚未采用的已定稿方向 | Roadmap Markdown |
| 多方案比较与裁决 | Design Markdown |
| 带日期的外部事实与研究 | Research Markdown |
| 测试身份、功能归属和回归关系 | 测试声明旁的 `// @concord-*` 注释 |
| 问题、决策、可复用经验及历史 | Memory Markdown |
| 待跟进观察及关联问题 | 本地 Issue 草稿 |
| 文件摘要与测试标注解析缓存 | 可删除、可重建的 SQLite cache |
| 命令运行证据与中断恢复材料 | 独立于 cache 的 Git-private 文件 |

Git 保存需要协作和审阅的事实。SQLite 是这些事实的投影，删除数据库不应删除契约、测试关系、Memory 历史或运行证据。

## 在测试旁声明关系

标注形式如下。关系与测试一起出现在 diff 中，不需要再维护一份测试关系 JSON：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/login.js';

// @concord-case login-rejects-expired-token
// @concord-contract docs/feature/login/use-case/expired-token.md
// @concord-regression memory/expired-token-accepted.md
test('rejects an expired token', async () => {
  const result = await login({ token: 'expired' });
  assert.equal(result.accepted, false);
});
```

Case ID 不依赖标题或行号，当前扫描集合必须唯一；测试演进保存在 Git 中，不承诺已删除身份永远不可复用。Concord 用语法树把注释关联到测试声明，检查重复身份、无效引用和无法明确关联的标注。
注释表示归属，不表示测试执行过，也不能据此计算已经通过的覆盖率。

项目级配置仍然可以使用 JSON，保存测试目录、runner 命令和超时等机械配置。测试关系只在源码注释中定义。

## 一条完整的研发路径

```text
Observation / Research
         ↓
Design → Roadmap → Feature / Use Case
                           ↑
                    测试源码中的归属注释
                           ↑
                     实际命令运行证据
                           ↓
                    Memory 裁决与历史
                           ↓
                     Trace / Review
```

1. 写清用户目标，比较并裁决必要的设计选择。
2. 将采用的目标写入 Feature，将完整用户路径写入 Use Case。
3. 在真实测试声明旁关联契约；需要保护历史问题时关联 Problem Memory。
4. 从项目自己的公开入口取得运行结果。
5. 结合红绿证据与修复理由关闭 Problem，保留历史；再次发生时重开并取得新一轮证据。
6. 从 Trace 反查影响，用 Review 汇集本次审阅材料。

## 证据能说明什么

Concord 的通用 runner 记录显式命令、源文件摘要、契约摘要、候选内容、退出状态和进程清理结果。
这种证据明确标为 `command`：它能证明所记录命令的结果，不能自动证明某个原生测试 case 实际执行、所有断言依赖完整或整个产品已被覆盖。

Problem 的 `fixed` 表示作者给出修复裁决，并附有通过校验的 command 红绿证据。工具拒绝陈旧定义、不同 Problem 轮次或不满足条件的收据。
它不把普通命令结果转换成 NiceEval formal E2E 或可靠性证书。

## SQLite 的职责

SQLite 缓存文件摘要和已解析的标注。Trace 每次结合当前 Markdown 编译关系，用于反查 Feature 的测试和 Memory 的回归保护。
缓存使用内容摘要和解析器版本失效；删除文件、重命名、切换分支和修改标注都需要反映到下一次查询。

数据库损坏或版本不匹配时，查询回退到源文件；可以用 `cache clear` 后 `cache rebuild` 恢复缓存。Problem 的关闭、裁决历史和正式 owner 文件写入不能依赖某条缓存记录是否存在。
缓存刷新也不会执行项目测试命令。

## 本地开发

环境：Linux 本地文件系统、Node.js 24.15+、pnpm 11.18.0、Git。项目使用 TypeScript、固定版本的 Effect，以及 Node 的 SQLite 接口。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

本地包名为 `concord-sdlc`，命令名为 `concord`。项目尚未发布到 npm。

## 安装与使用

Linux 可以从 Homebrew tap 安装：

```sh
brew install CorrectRoadH/tap/concord
```


从这个仓库构建本地安装包，再安装到独立工具目录：

```sh
cd /home/ctrdh/Code/Concord
pnpm install --frozen-lockfile
pnpm build
npm pack --ignore-scripts
npm install --prefix ~/.local/share/concord ./concord-sdlc-0.2.0.tgz
export PATH="$HOME/.local/share/concord/node_modules/.bin:$PATH"
concord --help
```

包附带 `npm-shrinkwrap.json`，锁定 Effect 预发布版本及传递依赖。源码开发用 `pnpm-lock.yaml`；升级依赖时同时更新两者并重新做安装验收。

在一个已有 Git 仓库的根目录执行：

```sh
concord init
concord feature create login --title "Login" --body ./login.md
concord use-case create expired-token --feature login \
  --title "Reject expired tokens" --body ./expired-token.md
concord memory add expired-token-accepted --kind problem \
  --title "Expired token was accepted" --body ./problem.md
# 在测试旁写入上方注释，然后检查关联。
concord check
concord test list
concord test run login-rejects-expired-token --json
# 修复实现后再次运行，取得 green 收据。
concord memory resolve expired-token-accepted --kind fixed \
  --red ccev_REPLACE_WITH_RED_ID --green ccev_REPLACE_WITH_GREEN_ID \
  --reason "The corrected validation rejects expired tokens"
concord trace show docs/feature/login/README.md
concord review render
```

`--body -` 从 stdin 读取正文。`--root /path/to/repo` 可显式选择消费仓库；结构写入支持 `--dry-run`，正文修改使用 `author set --expected-digest` 防止覆盖并发编辑。命令和字段说明从对应 `--help` 获取。

默认 runner 使用 Node 原生测试。索引支持 `node:test`、Vitest、Playwright 的直接 import 绑定、顶层字面量测试名和静态 callback。嵌套、参数化及无法明确绑定的声明会产生诊断；已知 skip/todo 不能作为修复证据。其它 runner 在 `concord.json` 配置显式 argv，`{file}`、`{name}`、`{pattern}` 必须各自占一个完整参数，执行时不经过 shell。

本地数据库位于 Git-private 的 `concord/cache.sqlite`；收据位于独立的 `concord/evidence/`。克隆仓库后历史裁决仍保留，未复制的私有证据显示不可用。忽略文件、依赖环境和外部服务不属于 Git 候选摘要的完整性保证。

`pnpm check` 执行类型检查、领域与恢复验证，并打包安装到临时目录运行真实 CLI 红绿闭环；首次安装验证可能下载锁定的 npm 依赖，不调用模型或产品服务。

## NiceEval 仓库接入

`concord repo` 承接 NiceEval 原有仓库维护命令。项目内继续使用 `pnpm run repo …`、`pnpm memory …`、`pnpm pr:body …` 等入口；这些脚本调用锁定版本的 Concord。

此模式保留现有 Markdown、测试 sidecar、Memory 历史及 formal E2E 证据，不转换为通用模式的 command 收据。真实 inventory、candidate/Testkit 与 takeover 由消费仓库 host 拥有。全局 brew engine 与仓库锁定字节不同时会拒绝执行，提示使用项目入口。

具体边界见 [Repository profile](docs/repository-profile.md)。

## 边界与资料

Concord 不替代原生测试框架、CI 或 Git。它管理契约、关系、生命周期与证据，并为这些工具提供可检查的上下文。
Issue 功能维护本地草稿；远端 GitHub 状态、发布和部署需要独立适配及明确授权。

- [架构与行为契约](docs/architecture.md)
- [独立化设计](docs/design.md)
- [来源与抽取边界](docs/provenance.md)
- [Agent 工作入口](docs/agent-workflow.md)
- [开发规则](AGENTS.md)
