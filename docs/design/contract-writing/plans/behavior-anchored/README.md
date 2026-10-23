# 行为锚定：重写 C-011 与 C-012

## Problem

C-011 与 C-012 需要直接给出“写什么、写在哪、关联到哪”的规则，而不是只划出禁止项。

## Core Mental Model

C-012 拥有契约写法：行为页写可观察行为与公开接口，architecture 与 lifecycle 页写内部实现，过程不进入契约。C-011 拥有关联：测试与代码声明指向能完整、准确描述其职责的最小既有契约范围。C-012 中与写法无关的三款原文移到更合适的条款。

### C-011 修订正文

> ## C-011 关联由源码声明拥有，指向最小完整范围
>
> 1. 测试根中的 Concord 标记是测试关联的唯一正向来源，标记存在即关联存在。静态关联扫描不解析宿主语言的测试声明、框架绑定、回调或 skip/todo。执行时的原生收集、绑定与选择仅按第 6 款进行，其观察结果不创建关联，也不授权静态关系检查成功。
> 2. 实现关联的唯一正向来源是通过语法、作用域、位置与目标校验的显式代码声明。未通过校验的标记产生 finding，不建立关联。反向关系从测试标记与代码声明派生。
> 3. 测试与实现指向能完整、准确描述该测试断言或该声明职责的最小既有契约范围：Use Case 步骤、行为页的标题 anchor、整个 Use Case、Feature README、Engineering owner，或 architecture 与 lifecycle 页的 anchor。对使用者可观察的保证先写进行为页再关联；只服务内部不变量或仓库维护机制的代码与测试，指向 architecture、lifecycle 或 Engineering。跨步骤的完整断言指向整个 Use Case，一个声明服务多项行为时使用多个 implements。
> 4. 代码侧选择完整且受支持的语义范围。整个文件服务同一职责且没有更精确的适用目标时，使用文件级声明。不为追求更窄而拆分实现、复制测试或机械改名步骤。缺少逐步骤关联不说明缺少执行或覆盖。
> 5. JS/TS 仅用注释范围排除字符串和模板中的伪标记；其它文本文件接受以 `//`、`#` 或 `--` 开头的标记行。
> 6. 执行由接入项目的 runner 命令或显式配置的 adapter 负责。（现行第 3 款全文保留。）

### C-012 修订正文

> ## C-012 契约写可观察行为，实现与过程各归其位
>
> 1. 行为页（Feature README、Use Case、cli、library）用使用者的语言声明输入、可观察结果、错误与约束。公开的输入输出结构、协议、机器可读字段、具名错误码、退出码，以及使用者可观察的持久化与恢复保证，属于行为页。行为页不写内部模块、内部数据结构、调用链和引擎选型。
> 2. 规范性陈述应能被测试断言。命令页给出完整调用、机器可读输出、退出码、具名错误与最小示例；API 页给出签名、返回值与失败。人读输出示例用于理解，可以规范化动态值，不保证逐字稳定（C-015.3）。实现之前的示例标为预期输出；交付验收核对实际运行，运行记录进入 Memory，示例不作为运行证据。同一输出或错误定义只在一个行为页维护，其它页面链接引用。
> 3. architecture 与 lifecycle 页声明该 Feature 的内部实现：实体归属、数据流、不变量、失败阶段与资源生命周期。它们随实现修改，不重新定义行为。跨 Feature 的系统边界写在项目 `docs/architecture.md`。只改内部实现的修改不改行为页。
> 4. Roadmap 与 Feature 同体裁，表示尚未采用的方向，其示例均为预期输出。实现与测试不指向 Roadmap。
> 5. 约束用现行句式表达，只描述当前规则，不描述它与过去的差别，不点名已删除的接口、实现或文档。
> 6. 实施日志、进度、待办、排障经过、测试运行记录、审阅与挑战经过、提交收据和 agent 交接不进入 `docs/`。排障经过、根因和可复用经验归 Memory，待调查的观察归 Issue，正式采用的目标归契约。Research 的研究事实、Design 的候选与裁决，以及工具拥有的修订和生命周期元数据，由各自 owner 保留，不借此记录实施日志、审阅经过或交接。本规则不授权删除或改写既有证据、来源及生命周期历史。

### 移出 C-012 的条款

三款逐字搬迁，义务不变：

| 现行条款 | 新位置 | 搬迁正文 |
| --- | --- | --- |
| C-012.4 | C-001 第 5 款 | Agent 对 Memory 与 Issue 的索引、检索、读取、创建、编辑、关联和生命周期操作必须通过 Concord CLI 或受管 API，不直接编辑 owner 文件、metadata 或 history，不维护人工 INDEX。工具缺口必须补齐或明确报告，不用手写文件绕过。 |
| C-012.5 | C-002 第 3 款 | 本地 Issue 不依赖外部服务。远端写入需单独授权，本地操作不自动投射为远端变更。 |
| C-012.6 | C-007 第 4 款 | 凭据只从环境变量或外部工具登录态读取，不写入 docs、配置、缓存、证据、HTTP 响应或诊断。 |

## Scope

- 改写 C-001、C-002、C-007、C-011、C-012 的正文，anchor 不变。
- 引用逐项按语义核对，不只检查 anchor 是否存在：
  - 正文用 c-012 支持凭据规则的三处改为 c-007：
    - `docs/design/repository-workflows/LIMITS.md`
    - `docs/design/repository-workflows/plans/main-cli-owned/architecture.md`
    - `docs/design/lsp-integration/LIMITS.md`
  - 在 metadata 中引用 c-012 的 owner，按内容补引用：Memory/Issue 工具维护补 c-001，本地 Issue 补 c-002，凭据补 c-007。仍有写作或过程约束的保留 c-012。至少核对 feedback、project-onboarding、local-sdlc、web-workbench 与 repository-workflows。
  - 核对 C-001、C-002、C-007 的既有反向引用在新增款后仍然成立。
- 同步修改随包 skill（主入口与 `document`、`code`、`test` 主题）、`docs/concord.md`、init 生成的指引与 Use Case 模板，使 Agent 读到同一套规则。
- 不改变 CLI 行为、标记语法、身份派生算法或 JSON 字段。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不改变关联语法与身份算法) | satisfied | 修订只约束目标与范围的选择，不改变语法、派生算法或格式；采用本身不重写任何标记或收据 | C-011 修订正文第 2 款保留既有声明校验，第 3、4 款只规定选择 |
| [L2](../../LIMITS.md#l2-事实仍只有一个-owner) | satisfied | 关联仍写在源码中，反向关系派生；同一输出定义只在一个行为页维护 | C-011 第 1、2 款，C-012 第 2 款末句 |
| [L3](../../LIMITS.md#l3-修订遵守宪法修订程序) | satisfied | 保留全部 anchor，逐字搬迁三款，按语义修正引用，通过 `constitution amend` 采用 | 本页 Scope |
| [L4](../../LIMITS.md#l4-不把规则写成合规证明) | satisfied | 修订正文只写规则；C-011 第 4 款明确缺少逐步骤关联不说明缺少执行或覆盖 | 修订正文中没有现状描述 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-不看代码也能判断行为) | satisfied | C-012 第 1、2 款要求公开接口、错误与示例写在行为页，且规范性陈述可断言 | 样板 `resolve-with-command-evidence.md` 可写出 C1 的断言 |
| [G2](../../GOALS.md#g2-重构不改行为页和测试标记) | satisfied | C-012 第 1、3 款把内部实现限定在 architecture 页，C-011 第 3 款让测试指向行为；内部不变量测试指向 architecture 页，重构时随实现调整 | 设计论证；C3 尚未实际执行 |
| [G3](../../GOALS.md#g3-关联能回答哪段代码实现了哪一步) | partial | C-011 第 3、4 款规定最小完整范围。`use-case steps`、`trace show` 与 `review render` 已区分步骤、整个 Use Case 与非步骤关联，`trace gaps` 提示未标记列表；尚无判定声明范围过粗的语义检查，由作者与审阅执行 | `concord --skill test` 的步骤查询说明；C4 由三步骤样例人工验证 |
| [G4](../../GOALS.md#g4-规则对人和-agent-同样可执行) | satisfied | 每款可逐条检查，同步进随包 skill 与模板 | 本页 Scope |

## Entry Points

修订正文写在本页。采用后，现行规则只在 `docs/constitution.md` 中维护。
