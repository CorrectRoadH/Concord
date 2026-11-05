# 文档模型

Concord 管理的文档按回答的问题分组。身份、类别、所属关系与名称由位置和一级标题决定；只有推导不出的语义写在 frontmatter，字段只在非空时出现。全部文件都可以直接编辑，Concord 从文件派生索引与反向关系，`concord check` 检查它们是否一致（[事实归属](#事实归属)）。

| 分组 | 文档 | 位置 | frontmatter |
| --- | --- | --- | --- |
| Spec | Feature：使用者能用的一项功能，页面见[页面种类](#页面种类) | `docs/feature/<f>/` | 无 |
| Spec | Engineering：维护者用来开发本项目的一项能力，例如构建、测试、性能测量与发布；页面种类同 Feature | `docs/engineering/<t>/` | 无 |
| 提案 | Roadmap：还没开始实现的方向，结构同 Feature；实现与测试不指向它 | `docs/roadmap/<r>/` | 无 |
| 项目规则 | 品味、术语、写作政策 | `docs/taste.md`、`docs/**/concepts.md`、`docs/**/writing.md` | 无 |
| 待定的取舍 | Design：一个还没定下来的取舍，列出几种做法和各自的代价 | `docs/design/<d>.md` | 无 |
| 待处理 | Issue：还要处理的缺陷、请求或观察 | `docs/issues/<i>.md` | `relations`、`source` |
| 经验 | Memory：开发中可复用的经验 | `memory/<m>.md` | `relations` |

文档只描述现在。修改历史、为什么改、谁在什么时候处理完了什么，都由 Git 保存，Concord 不另存版本、修订记录或状态历史。

`docs/` 下其它 Markdown 是普通文档，不是 owner。

## 身份

canonical 仓库相对路径是唯一身份。目录名与文件名是同类别内的短选择器，歧义时具名拒绝；名称取自正文唯一的一级标题，与路径 slug 可以不同，不超过 1024 个字符。名称保留 Unicode 原拼写与组合标记，大小写与 Unicode 规范化碰撞按路径保护规则拒绝。移动文件即改变身份，`check` 报告全部失效的精确引用。frontmatter 中的路径值是仓库相对路径。

## Issue

Issue 只表示还要处理的问题。处理完就删除文件：`issue close` 先执行需要的步骤，例如 fixed 时核验回归测试，再删除 Issue，并输出可写进提交说明的结论。`relations` 带角色：`investigation` 与 `root-cause` 指向 Memory，`adopts` 指向承接它的 Spec，`related` 指向另一个 Issue。远端来源的 `source` 保存 provider 的稳定身份与首次来源摘录，见 [Feedback](feature/feedback/architecture.md)。

## Memory

Memory 只保存开发中可复用的经验：测量结论、根因、踩过的坑和做过的取舍。经验过时就改写或删除，不保留状态与替代关系；过程日志、验收记录和修改记录不写进 Memory。`relations` 的 `supports` 指向它支持的 Spec。

## Design

Design 只用于真正难以取舍的问题，例如一个 API 有几种可行的形状。一页写清要决定什么、几种做法和各自的代价。定下来后把采用的规则写进 Spec，删除这一页。

## 格式边界

只有当前格式（[当前格式](architecture.md#当前格式)）。frontmatter 严格解码，未知字段与可推导字段都是无效输入。

发布与恢复使用 Git-private 的短发布租约与 journal 协议。读取使用乐观快照，提交短期独占；dry-run 不发布文件。无法解码的 journal 保留现场并阻断写入。

配置 `concord.config.ts` 可以不存在；存在时只声明 runner、测试与源码目录的覆盖、排除项与可选集成，见[维护项目配置](feature/project-onboarding/use-case/maintain-project-config.md)。

## 事实归属

每项事实只由自己的来源维护（[一件事只写一次，其余推导](taste.md#t-3)）。

1. 每项事实只有一个 owner。Spec 正文由 Markdown owner 拥有；领域术语由 docs 下按目录归属的 `concepts.md` 拥有，写作政策由同目录的 `writing.md` 拥有；测试定义与正向关系由测试源码拥有。Issue 拥有还要处理的问题的正文与关系，Memory 拥有经验的正文与关系；历史在 Git。
2. 目录确定术语与政策的局部作用域，docs 根拥有全局定义。术语的定义与解释写在同一 `concepts.md`；其它 Markdown 链接到定义，不重复维护。
3. 反向关系、聚合索引与引用反查从来源派生，不维护第二份登记表。
4. 人与 Agent 直接编辑 `docs/` 与 `memory/` 下的文件，包括 Memory 与 Issue；索引、检索与反向关系由 Concord 从文件派生，不维护人工 INDEX。关系由 `concord check` 检查，Concord 命令是执行需要运行的步骤的助手。

## 页面职责

Feature 的页面按读者的问题分工（[读得懂胜过写得全](taste.md#t-1)）。

1. 行为页（类别为行为的页面，见[页面种类](#页面种类)）用使用者的语言声明输入、可观察结果、错误与约束。公开的输入输出结构、协议、机器可读字段、具名错误码、退出码，以及使用者可观察的持久化与恢复保证，属于行为页。行为页不写内部模块、内部数据结构、调用链和引擎选型。
2. 规范性陈述应能被测试断言。命令页给出完整调用、机器可读输出、退出码、具名错误与最小示例；library 页给出签名、返回值与失败，api 页给出协议的请求、响应与错误。人读输出示例用于理解，可以规范化动态值，不保证逐字稳定（[机器可读输出](feature/local-sdlc/cli.md#机器可读输出)）。实现之前的示例标为预期输出；交付验收核对实际运行，运行记录进入 Memory，示例不作为运行证据。同一输出或错误定义只在一个行为页维护，其它页面链接引用。
3. architecture 与 data-model 页声明该 Feature 的内部实现：实体归属、数据流、不变量、失败阶段与资源生命周期。它们随实现修改，不重新定义行为。跨 Feature 的系统边界写在项目 `docs/architecture.md`。只改内部实现的修改不改行为页。
4. Roadmap 与 Feature 同体裁，表示尚未采用的方向，其示例均为预期输出。实现与测试不指向 Roadmap。
5. 页面种类见[页面种类](#页面种类)。README 与 cli、library 等行为页像使用教程一样写谁用它、能做什么、怎么做；architecture 与 data-model 页是技术实现；Use Case 把功能连到用户旅程。README 给出用户价值、一个照着就能运行的上手示例和 Use Case 导航；输出字段、具名错误与退出码写在 cli 或 library 页，README 只链接它们。
6. 每个 Use Case 描述一个用户旅程：起始状态、使用者的每步动作、要运行的命令或调用，以及看到的输出。用户目标或处理路径明显不同时，另写一个 Use Case；同一路径中的输入变化与错误结果可以用表格说明。拆分应帮助读者理解操作，避免重复相同的步骤（[读得懂胜过写得全](taste.md#t-1)）。
7. 文字难以说清的过程配图解。多方协作、状态迁移、时序和数据流程用 p5 动画演示，静态结构用 Mermaid。图解只演示页面已声明的规则，不新增规则，也不作为运行证据。

## 页面种类

Feature、Engineering 与 Roadmap 的目录是同一种包，使用同一组页面，文件名就是页面种类。每种页面回答一个读者问题，同一事实只写在回答它的那一页，其它页面链接过去（[一件事只写一次，其余推导](taste.md#t-3)）。Feature 声明产品向使用者提供的能力；Engineering 声明开发本仓库所需的维护能力，例如测试方案写成 `docs/engineering/testing/`，构建方案写成 `docs/engineering/build/`。

| 文件 | 类别 | 回答 | 写什么 | 不写什么 |
| --- | --- | --- | --- | --- |
| `README.md` | 行为 | 能做什么、怎么开始 | 谁用、能做什么、上手示例、怎样工作、范围与验收方式、Use Case 导航 | 字段、错误码、界面状态、内部机制 |
| `use-case/<u>.md` | 行为 | 某个情形下发生什么 | 起始状态、带 `{#id}` 的步骤、要运行的命令、看到的输出、结果表 | 内部模块 |
| `cli.md` | 行为 | 命令怎么调用 | argv、人读输出、stdout 与 stderr、`--json` 字段、退出码、具名错误 | 内部模块 |
| `library.md` | 行为 | 库怎么调用 | 导出的签名、返回值、失败 | 第三方依赖选型 |
| `api.md` | 行为 | 其它程序通过网络协议怎么调用 | 公开的 HTTP 路由、RPC 方法与事件，请求与响应结构、状态码、错误、兼容规则 | CLI 调用；内部进程间通信 |
| `format.md` | 行为 | 使用者编辑或读取的文件长什么样 | 受支持的文件的路径、语法、字段、校验错误与示例 | 缓存、journal 等内部存储 |
| `ui.md` | 行为 | 界面怎样呈现和响应 | 布局、交互状态、键盘与可访问性要求、视觉验收 | 组件、样式变量与源码路径 |
| `performance.md` | 行为 | 多快才算合格 | 场景 ID、测量内容、预算，以及理解预算所需的负载与环境前提 | 测量方法；资源安全上限 |
| `architecture.md` | 实现 | 怎么实现 | 模块与职责、数据流、不变量、失败阶段、资源生命周期、内部进程间通信、关键取舍与依赖选型 | 重新定义行为 |
| `data-model.md` | 实现 | 内部存什么 | 实体、存储结构（文件、表或键）、字段类型与约束、唯一性与索引、事务边界、数据生命周期 | 公开文件格式 |
| `concepts.md`、`writing.md` | 项目规则 | 用哪些词、怎么写 | 见[术语与语言](#术语与语言) | — |

### 路径与识别

1. 包的入口是 `README.md`，必需，不拆分。其余页面按需要创建。
2. `use-case/` 是 Use Case 的集合：`use-case/<u>.md` 是一个用户旅程，`use-case/README.md` 是可选的导航页，不是旅程。Use Case 不嵌套，也不跨多个文件。
3. 除 `README.md`、`use-case/`、`performance.md`、`concepts.md` 与 `writing.md` 外，一种页面写不下时，把 `<种类>.md` 换成 `<种类>/` 目录：入口是 `<种类>/README.md`，其余页面自由命名，种类都与目录相同。同一种类的单页与目录不能并存。种类目录不产生新的 Feature 或 Engineering，其中的页面与锚点仍以精确路径引用。
4. 识别顺序：包入口，`use-case/` 下的页面，各层的 `concepts.md` 与 `writing.md`，种类单页与种类目录。包内仍无法归类的 Markdown 页面由 `concord check` 报告 `UnknownPageKind`；它是 `relation` 类 finding，使检查失败，页面照常被发现、阅读与编辑。拼写接近某个种类时，finding 给出该种类，否则列出全部种类。
5. 分类目录的 README、包外的 `docs/` 普通文档（例如 `docs/guides/<g>.md`）、`docs/_template/` 与非 Markdown 文件不受种类限制。项目的说明性文档放在包外，用链接连到 Spec。

### 重叠时的归属

- 同一个领域结构或错误被多个入口使用时，只在一个行为页定义，其它页面只写自己入口的映射，例如 HTTP 状态码。
- 公开文件约定在 `format.md`，内部存储在 `data-model.md`；能被打开阅读不等于公开格式。存储结构简单时可以只写在 `architecture.md`，拆出后只链接。
- 性能预算只在 Feature 的 `performance.md`，Use Case 与 README 只链接。测量方法归 Engineering 的性能主题；测试时限、输出上限这类资源上限写在所属的行为页或实现页，不是预算。

## 只写当前声明

声明式页面只写现在（[写现在，不写过去](taste.md#t-4)）。

1. 约束用现行句式表达，只描述当前规则，不描述它与过去的差别，不点名已删除的接口、实现或文档。
2. 实施日志、进度、待办、排障经过、测试运行记录、审阅与挑战经过、提交收据和 agent 交接不进入 `docs/`。排障经过、根因和可复用经验归 Memory，待调查的观察归 Issue，正式采用的目标归 Spec。
3. 声明式 owner（Feature、Use Case、Engineering、品味、`concepts.md` 与写作政策）只保存当前声明，不保存创建时间、采用来源、修订日期或修订历史。这些事实由 Git 保存。

## 术语与语言

一个词一个意思（[一个词一个意思](taste.md#t-2)）。

1. Spec 页面用到的领域名词由生效范围内的 `concepts.md` 定义。一个概念只用它的 term 一种写法，不在中英两种写法之间切换；新名词先进入 `concepts.md`，再进入 Spec。
2. Spec 页面使用项目文档的主语言。命令、字段、错误码和代码标识写在行内代码中，不当作正文名词翻译或改写。
