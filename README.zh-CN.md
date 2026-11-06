# Concord

**以 Spec 驱动开发：人审阅 Spec，agent 按 Spec 实现并用测试证明，Concord 检查三者是否一致。**

[English](README.md) · 简体中文

Concord 是面向开发者和 coding agent 的本地 Spec 驱动开发工具。Spec 是软件必须做什么的唯一事实来源。人审阅 Spec 的变化；agent 按 Spec 实现，并用测试证明；Concord 检查 Spec、实现与测试是否仍然一致。CLI 和随包提供的 Web 工作台操作同一份仓库文件。

所有内容都是 Git worktree 中的普通文件，人和 agent 直接编辑全部文件。Concord 命令执行变化需要运行的步骤，例如修复核验。`concord check` 检查 Spec、测试与实现是否仍然一致。核心流程不需要账号、模型 API 或云服务。

## 开发流程：Spec 先于实现

Concord 采用 Spec 驱动开发（SDD）：先明确目标行为，再实现，并让 Spec 持续作为后续改动的依据。项目的语言、包管理器和测试 runner 由项目自己选择。

1. **读懂现有意图。** 从相关 Feature、Use Case 和项目规则开始，沿着已有映射查看代码与测试，再决定改什么。
2. **先在 Spec 中写清并审阅变化。** 描述用户做什么、看到什么、如何验收。定下尚未明确的设计问题，把采用的规则写进 Spec，再实现受影响的行为。
3. **实现并测试这些行为。** 代码与测试关联到对应的 Use Case 或步骤。实现期间发现目标行为需要调整，先更新 Spec，再继续对应的改动。
4. **验证并审阅结果。** 运行 `concord check` 和项目自己的测试、质量检查。把 Spec 差异、关联实现与测试结果放在一起审阅；关联有效本身不能证明行为正确。

这四步通常由不同角色完成：写 Spec 的人定下命名、行为和验收方式；实现者照着 Spec 做，只在 Spec 缺失或与事实冲突时停下，带着证据回到 Spec；验收者对照 Spec 和实际运行判断结果，不以“测试通过”代替验收。Spec 写到实现者不用再问，人和不同的 agent 才能并行开发而不各自猜测（[品味](docs/taste.md#t-11)）。

不同改动有不同的起点：

| 改动 | 怎样推进 |
| --- | --- |
| 新增或改变行为 | 先更新 Feature 与受影响的 Use Case，再实现并测试 |
| 实现违反 Spec 的缺陷 | 保留目标行为，先提交失败的回归测试，再提交修复并[核验](#修复缺陷) |
| 保持行为不变的重构 | 保持行为 Spec 稳定，内部设计变化时更新 architecture 页，并验证既有行为 |

[项目治理 Spec](docs/feature/neutral-project-governance/README.md) 定义共同规则，[Agent 指引](skills/concord/SKILL.md) 说明执行这些步骤时使用的工具。

### 改了 Spec，怎样找到要改的代码与测试

Use Case 到代码、测试的关联，承担从产品意图定位实现的 source map 作用。代码和测试在源码中声明关联，Concord 推导反向映射。修改某条行为时，可以从 Use Case 或其中一步，找到需要检查的函数、代码段与测试。

例如，问候功能要改变空名字的处理方式，先修改对应 Use Case。在已有[快速上手](#快速上手)中 `greeting` Feature 的项目里，可以查看它的关联和项目中的缺口：

```sh
concord --fresh trace show docs/feature/greeting/use-case/greet-name.md
concord --fresh trace gaps
```

已有关系帮助定位行为变化后需要审阅和修改的实现与测试；关系缺口列出没有声明实现或测试关联的行为。检查每个缺口，判断是工作尚未完成，还是已有实现需要补关联。

已经关联的代码也要对照变化后的 Spec 核验。映射不会自动判断语义是否正确。

详细说明见[关系缺口](docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md)与[追踪和审阅](docs/feature/local-sdlc/use-case/review-traceability.md)。

## 解决什么问题

Concord 首先解决三个问题。

**Spec 写完没人看得懂。** 规格写成一长串约束、字段和边界，作者以外的人读完也说不出功能能做什么、第一步该运行什么；看不懂的 Spec 不会被认真审阅，也就没人维护。Concord 要求 Feature 像教使用者上手一样写：先讲能做什么，再给一个照着就能运行的例子；Use Case 按教程一步一步写；文字难以说清的过程配 p5 动画。

**AI 随意用词。** agent 每次对话都可能给同一个东西换个名字，或者把中英文写法混着用，读者只好猜两个词是不是一回事。Concord 让每个概念在 `concepts.md` 里只有一个名字和一段定义，旧名字一出现，`check` 就报告。

**AI 写一大堆没用的测试。** agent 很容易为每个函数、每个分支补测试，测试越来越多，却没人说得清哪个测试在守护哪种用法，读测试也看不出产品该怎样表现。Concord 要求每个测试标注它验证的 Use Case 或其中一步，测试因此能按用户旅程来读；没有关联任何 Use Case 的测试会被列出来，供你检查其目的并决定如何处理。

围绕这三点，还有几类和 agent 一起开发时常见的复杂性：需求散在聊天记录和 PR 描述里，设计取舍只在某个人的记忆里；agent 每次从零开始，会重新决定已经定过的语义；测试声称保护某个功能，但没人能确认它保护的是哪一条行为；问题在没有证据时就被宣布修复。审阅几千行生成的代码，也比审阅背后几句意图难得多。

Concord 让审阅从 Spec 开始。Spec 是仓库中的 Markdown，代码与测试用源码标记指向 Spec，反向关系由工具从源码推导。审阅者读 Spec 怎样变化，沿关联查看实现与测试，再对照目标行为核验结果。

## 如何化解开发中的复杂性

| 复杂性 | Concord 的做法 | 带来什么 |
| --- | --- | --- |
| Spec 读不懂，审阅流于形式 | README 与 cli 页是产品功能；architecture 页是技术架构；Use Case 按不同用户目标或路径组织，附输出，同一路径的变化用表格说明 | 第一次读的人能说出功能做什么、怎么开始，审阅者看得出意图变了什么 |
| 过程和时序用文字说不清 | Markdown 中的 `p5` 代码块在 Web 工作台里自动循环播放，静态结构用 Mermaid | 多方协作、状态迁移看一遍动画就懂；文字仍是规则本身，图解只演示 |
| AI 和人对同一个东西用不同的词 | `concepts.md` 给每个概念一个名字和定义，按目录划分作用域；弃用名由 `check` 报告 | 读者不用猜两个词是不是一回事，agent 按字面读也不会读出第二种意思 |
| 用词含糊、句子越写越长 | `writing.md` 禁用 `helper`、`resolve` 这类不说明职责的词，并限制句长与段长，每条规则附替代写法和理由 | 实现者不必猜作者的意思 |
| agent 每次从零开始，重新决定定过的事 | 跨 Feature 的规则写进品味，方案取舍写进 Design，调查结论写进 Memory，都在仓库里 | 新会话读到的是现行约定和理由，不会推翻已经定下的语义 |
| 改了 Spec，不知道代码和测试该改哪里 | 测试与代码用源码标记指向 Use Case 或其中一步；反向关系与关系缺口从源码推导 | 从变化的行为出发检查关联代码与测试，再调查缺口中是否有遗漏的工作 |
| 重构把 Spec 和测试一起搅乱 | 行为页（README、Use Case、cli、library）与 architecture 页分开 | 只改实现时只改 architecture 页，行为页和指向它们的测试保持稳定 |
| 问题没有证据就被宣布修复 | 缺陷写成 Issue；`issue close --fixed` 核验 runner 在缺陷提交上失败、在修复提交上通过，删除 Issue，并输出供提交说明保存的结论 | 审阅者按记录的提交与测试 ID 重放核验 |
| 改着改着，Spec、测试和实现对不上了 | `concord check` 报告断开的链接、指向不存在 Spec 的标记和用错的词 | 人和 agent 直接改文件，出错时马上知道 |
| 开发日志混进 Spec | 过程写进 Memory，待调查的问题写进 Issue，`docs/` 只保留当前声明 | Spec 始终描述系统现在必须怎样 |
| 想法还没定，或者定了但暂不实现 | Roadmap 用 Feature 的写法保存方向，采用时移入 `docs/feature/` | 未定的方向不会被误当作现行要求 |

## 仓库里的每个文件

文件的位置和唯一的一级标题决定它的身份、类别与名称；frontmatter 只保存推导不出的事实，例如 Issue 的状态。字段的精确定义见[文档模型](docs/document-model.md)。

**Spec：系统现在必须怎样**

| 文件 | 是什么 | 谁在什么时候读 |
| --- | --- | --- |
| `docs/feature/<f>/README.md` | 产品功能的入口，像使用教程：谁用它、能做什么、上手示例、怎样工作（配图解）、Use Case 导航 | 任何人第一次了解这项功能时先读 |
| `docs/feature/<f>/use-case/<u>.md` | 一个用户旅程：起始状态、带 `{#step-id}` 的逐步动作与输出、结果；不同目标或路径单独成篇，同一路径中的输入与错误变化可以用表格说明 | 实现和写测试前读；测试标记指向这里 |
| `docs/feature/<f>/cli.md`、`library.md`、`api.md` | 命令、库或网络协议的完整调用、输出、`--json` 字段、退出码与具名错误 | agent 和脚本对接时读；这些字段是公开约定 |
| `docs/feature/<f>/format.md`、`ui.md`、`performance.md` | 使用者编辑或读取的文件格式、界面的布局与交互、性能预算 | 写文件、做界面或改高频命令时读 |
| `docs/feature/<f>/architecture.md`、`data-model.md` | 技术实现：模块与职责、数据流、不变量、失败阶段、资源生命周期与内部存储 | 改实现时读和改；行为不变的重构只改这些页 |
| `docs/engineering/<t>/` | 开发本仓库所需的维护能力，例如构建、测试与性能测量；页面种类同 Feature | 维护这个仓库的人读 |
| `docs/architecture.md` | 跨 Feature 的系统边界与模块划分 | 改动跨越多个 Feature 时读 |

**项目规则：所有 Spec 共同遵守什么**

| 文件 | 是什么 | 谁在什么时候读 |
| --- | --- | --- |
| `docs/taste.md` | 跨 Feature、长期有效的规则，每款有稳定 ID；依据它的句子旁链接该 ID | 规划、实现和审阅任何功能前读 |
| `docs/concepts.md`、`docs/**/concepts.md` | 术语表：每个二级标题是一个概念，标题是唯一写法，第一段是定义；frontmatter 列出弃用名 | 写下一个领域名词前查；所在目录决定作用域 |
| `docs/writing.md`、`docs/**/writing.md` | 写作政策：禁词及替代写法和理由，句长与段长上限 | 由 `check` 执行；写作者被报告时读理由 |

**提案与决策记录：为什么这样设计**

| 文件 | 是什么 | 谁在什么时候读 |
| --- | --- | --- |
| `docs/roadmap/<r>/` | 尚未采用的方向，写法同 Feature；实现与测试不指向它 | 讨论下一步做什么时读；采用时用 `roadmap start` 移入 `docs/feature/` |
| `docs/design/<d>.md` | 一个还没定下来的取舍：几种做法和各自的代价；定下来后把规则写进 Spec，删掉这一页 | 讨论这项取舍时读 |

**工作项与知识：哪里不对、学到了什么**

| 文件 | 是什么 | 谁在什么时候读 |
| --- | --- | --- |
| `docs/issues/<i>.md` | 还要处理的缺陷、请求或观察；处理完就删除，结论写进提交说明 | 接手问题时读 |
| `memory/<m>.md` | 开发中可复用的经验：测量结论、根因、做过的取舍；过时就改写或删除 | 开始相关工作前用 `concord memory search` 查 |

**接入、源码与派生数据**

| 文件 | 是什么 | 谁在什么时候读 |
| --- | --- | --- |
| `AGENTS.md` 中的 Concord 区块 | 告诉 agent 先读 Concord 的指引、交付前运行检查 | agent 每次进入仓库时读 |
| `concord.config.ts` | 可选配置：源码根、测试根、测试 runner、p5 扩展库 | 默认约定不适用时才需要 |
| 源码与测试中的标记 | 测试顶部的 `// @use-case <path>`，实现旁的 `// @concord-implements <path>` | 由 `check` 和 `trace` 读取，生成反向关系 |
| Git 私有目录下的 `concord/` | 每个 worktree 独立的缓存、写入恢复记录与租约 | 不需要读；缓存可以用 `concord cache clear` 删除，结论不变；恢复记录由 `concord recover` 处理，不要手工删除 |

## 可以做什么

- **定义要做的事。** 编写 Feature 与 Use Case，比较设计候选，在实现前记录明确裁决。
- **找到对应实现。** 从 Spec 反查标注过的文件、函数、代码段和测试，反向关系从源码派生。
- **证明修复。** 把缺陷写成 Issue，先提交失败的回归测试，再提交修复，以经过核验、可重放的结论关闭 Issue。
- **用图解释机制。** 在 Spec 里写 `p5` 代码块，Web 工作台自动循环播放，把多方协作和状态变化演示出来。
- **统一用词。** 在 `concepts.md` 定义概念，在 `writing.md` 写禁词；`check` 报告旧名字和含糊的词，并给出替代写法。
- **结合上下文审阅。** 在 Web 工作台查看 Spec、源码、测试、Issue、反馈与 Git 改动，或通过 CLI 生成本地审阅材料。

## 安装

Linux x64 或 Apple Silicon macOS 可以用一条命令安装（需要 Node.js 24.15+ 与 Git，装在用户目录下）：

```sh
curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
concord --help
```

也可以通过 Homebrew 安装：

```sh
brew install CorrectRoadH/tap/concord
concord --help
```

Linux 也可以使用 Nix：

```sh
nix profile install 'git+https://github.com/CorrectRoadH/homebrew-tap?ref=main#concord'
concord --help
```

运行需要 Node.js 24.15+ 和 Git，支持 Linux x64 与 Apple Silicon macOS；不支持 Windows。

## 快速上手

在已有 Git 仓库中初始化 Concord：

```sh
concord init
concord new feature greeting --title "Greeting" --pages use-case
concord new use-case greet-name --feature greeting --title "Greet a name"
```

Concord 默认发现 `src/`、`test/` 与 `tests/`，`concord.config.ts` 可以不存在。代码在其它位置时传 `--source-root` 或 `--test-root`，没有测试的仓库用 `--docs-only`。初始化会创建文档模板、项目品味，并在 `AGENTS.md` 中维护 Agent 指引区块。

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
4. 运行 `concord issue close duplicate-sku --fixed --reason "..."`。Concord 在缺陷提交与 HEAD 上分别运行配置的 runner。核验通过后删除 Issue、移除它的 `@issue` 标记，并输出应写进提交说明的结论。

保留回归测试及其 Use Case 关联。重放时，用 `concord test verify` 指定提交说明中的测试 ID 与两个提交。核验只证明 runner 在这两个快照上的运行结果，不代表完整测试覆盖。见[核验修复并关闭缺陷](docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md)。

## 打开 Web 工作台

```sh
concord view
```

打开终端显示的地址即可使用。工作台随安装包分发，提供文档编辑、实现与测试关联、Issue、Memory、反馈、术语和 Git 差异。Use Case 在所属 Feature 内浏览与维护。

省略 `--host` 时，服务监听 `127.0.0.1:4317`。服务没有身份验证，能连接该端口的人可以编辑仓库并运行配置的测试；只在可信网络中传 `--host 0.0.0.0`。

## 与 Agent 一起使用

初始化后，项目里有四个对应开发流程的 skill。Claude Code 中输入 `/concord-spec` 这样的斜杠命令，Codex 中输入 `$concord-spec` 触发；agent 也会按任务自动选用：

| skill | 做什么 |
| --- | --- |
| `concord-spec` | 把需求写成 Feature 与 Use Case，定下待决问题 |
| `concord-implement` | 照着 Spec 实现，关联代码与测试；Spec 不够时停下 |
| `concord-review` | 对照 Spec 与实际运行验收一组改动 |
| `concord-fix` | 按缺陷流程提交回归测试、修复并核验 |

已经初始化的仓库运行 `concord skills install` 补上它们。详见[用斜杠命令走开发流程](docs/feature/project-onboarding/use-case/run-workflow-from-agent.md)。

Agent 也可以读取当前安装版本随包提供的指引，无需先初始化仓库：

```sh
concord --skill
concord --skill document
concord --skill code
concord --skill test
concord --skill memory
```

用 `concord <command> --help` 查看精确参数，`--json` 获取结构化结果，`--root /path/to/project` 指定其它工作树。Agent 直接编辑 Spec、Issue 与 Memory；`issue close --fixed`、`roadmap start` 等命令执行这些变化需要运行的步骤。

## 深入使用

| 想做的事 | 阅读入口 |
| --- | --- |
| 理解工作流与事实归属 | [Spec-first 流程](#开发流程spec-先于实现) · [文档模型](docs/document-model.md) · [架构](docs/architecture.md) · [Agent 工作流](skills/concord/SKILL.md) |
| 查阅命令与输出 | [CLI](docs/feature/local-sdlc/cli.md) |
| 标注文件、函数和代码段 | [代码指引](skills/concord/references/code.md) |
| 运行测试与核验修复 | [测试指引](skills/concord/references/test.md) |
| 记录可复用的知识 | [Memory 指引](skills/concord/references/memory.md) |
| 将 GitHub、Linear 反馈与本地 Issue 一起查看 | [反馈命令](docs/feature/feedback/cli.md) |
| 确定项目在测试上自己负责什么 | [项目测试接入边界](docs/feature/local-sdlc/README.md#测试的边界) |
| 浏览产品 Spec | [文档目录](docs/README.md) |

链接中的详细指引与 Spec 以中文为主。两份 README 提供内容对应的产品介绍和入门流程。

参与开发 Concord 本身，见[工程指南](docs/engineering/self-hosting/README.md)。
