---
format: concord.constitution/v1
status: active
ratifiedAt: 2026-09-14
amendedAt: 2026-09-29
amendments:
  - date: 2026-09-14
    reason: 汇总已采用的工程约束，并落实本轮 dogfood 要求
    sources:
      - AGENTS.md
      - docs/architecture.md
      - docs/feature/project-onboarding/README.md
    impact: 适用于 Concord 后续 Feature、Design、实现与验收；不声明历史功能已自动符合全部规则
  - date: 2026-09-14
    reason: 落实用户无 legacy 运行时约束
    sources:
      - docs/design/ts-only-runtime/README.md
      - docs/feature/project-onboarding/README.md
    impact: 旧格式须离线迁移；保留现场，旧证据重新取证
  - date: 2026-09-20
    reason: 将项目实践提升为中立治理标准，明确消费者执行职责和不可降级的证据要求
    sources:
      - docs/feature/neutral-project-governance/README.md
      - docs/design/neutral-project-governance/README.md
    impact: 适用于 Concord 新接入设计及当前 repository 治理中立化；消费者适配中立协议，历史证明不自动升级，源码语言和包管理器仍由项目选择
  - date: 2026-09-22
    reason: 移除宪法语义版本并保留修订历史
    sources:
      - docs/feature/project-onboarding/use-case/evolve-constitution.md
      - docs/design/onboarding-contracts/plans/compatible/governance.md
    impact: 现有项目的宪法修订无需版本号；旧文件只读兼容，首次授权修订投影为无版本历史
  - date: 2026-09-22
    reason: 测试关联改为源码标记，不再解析宿主测试语法
    sources:
      - docs/constitution.md#c-010
      - docs/architecture.md
    impact: 标记存在即构成测试关联；旧的按测试标题派生的 neref_ 不再视为同一身份，已有命令证据须重新取证。不改变代码声明的 AST 规则，也不把命令收据升级为原生用例通过
  - date: 2026-09-23
    reason: 明确声明式契约与工程过程分工，并要求Memory/Issue通过Concord工具操作
    sources:
      - docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
      - docs/feature/feedback/use-case/manage-local-observations.md
    impact: 适用于后续Agent治理和init随包指引；保留既有来源历史、持久化格式和远端授权，不批量改写历史资料
  - date: 2026-09-23
    reason: 采用按目录拥有的结构化领域术语与写作政策
    sources:
      - docs/design/scoped-terminology/README.md
      - docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
    impact: 为领域术语与写作政策声明 JSON owner 例外；局部范围按目录，全局汇总派生，旧写作格式显式迁移，其他契约和证据来源不变
  - date: 2026-09-23
    reason: 按用户要求统一到HawDB，并落实独立挑战要求的窄原生边界
    sources:
      - docs/design/hawdb-data-engine/README.md
      - docs/feature/local-data-engine/README.md
    impact: 所有可重建缓存采用HawDB；只允许引擎桥接与所有权适配使用Rust，事实owner、证据、授权和TS/Effect领域职责不变；实现须满足已记录的生命周期、预算及同包平台验收
  - date: 2026-09-27
    reason: 按操作所需事实划分依赖，分开只读访问、发布协调与证据裁决
    sources:
      - docs/design/operation-boundaries/README.md
      - docs/architecture.md
    impact: 适用于当前架构重构与后续命令；保留 owner/journal 格式、路径安全、完整图门禁及既有证据下限，不声明未复现平台故障已解决
  - date: 2026-09-27
    reason: docs 只写声明；接入项目采用 Concord 范式并以 concord check 执行写作门禁；性能成为交付约束
    sources:
      - docs/feature/documentation-quality/README.md
      - docs/engineering/concord-self-hosting/performance.md
      - docs/feature/local-sdlc/README.md
    impact: 改写全部条款为编号规则，正文不再附来源行。C-010 要求接入项目采用 Concord 方法论（技术栈仍中立），concord check 纳入写作政策检查，属消费者兼容变更，契约与验收见 documentation-quality；C-012 禁止 docs 记录实施过程与点名已删除内容；新增 C-014 性能预算、测量方法与缓存一致性。经未参与方案的 GPT-6 Astra reviewer 只读审查三轮，全部阻断意见已按建议修订，结论 PASS。
  - date: 2026-09-28
    reason: 分离历史诊断与当前事实门禁，采用乐观读取及短期提交协调
    sources:
      - docs/design/asynchronous-projections/README.md
      - docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
    impact: 诊断查询可异步刷新并返回明确标识的历史投影；当前事实与证据门禁保持严格；普通读取不再持共享租约
  - date: 2026-09-29
    reason: 工作区导航由只读历史投影提供，允许诚实标注的来源漂移，防止普通编辑阻断工作台
    sources:
      - docs/design/workspace-projection/README.md
    impact: 仅扩展历史导航展示；当前查询、写入、check、恢复和证据仍使用当前事实。工作台缓存不可用具名失败，不回退扫描。
---

# Concord 项目宪法

本宪法规定 Concord 跨功能、长期有效的开发规则，以及 Concord 要求接入项目采用的工作范式。功能细节由 Feature 与 Use Case 拥有，跨功能机制由[架构](architecture.md)拥有，方案比较与裁决由 Design 拥有，agent 操作细则由 `AGENTS.md` 拥有。宪法只确立规则，不陈述代码是否已经符合。

## 总则

**适用范围。** 规则适用于生产代码、测试、构建脚本、随包模板与 skill，以及 `docs/`。标明“接入项目”的条款同时约束使用 Concord 的消费仓库。

**用语强度。** “必须 / 不得”是硬约束，违反即阻止交付。未使用这些词的规范性陈述同样有约束力。对“应当”的偏离须按项目既有决策权限采用，并在 Memory Decision 中记录条款、范围、理由、影响及复核条件；记录本身不产生授权，也不豁免“必须 / 不得”。“可以”表示允许。

**冲突处理。** 硬约束同时成立。写入安全与授权（C-003、C-007）、证据真实（C-004）、事实唯一（C-001）和性能（C-014）依次用于选择满足全部硬约束的方案，不授权违反其它条款。确实无法同时满足时，按 C-008 修订后采用。

<a id="c-001"></a>
## C-001 事实只由自己的来源维护

1. 每项事实只有一个 owner。契约正文由 Markdown owner 拥有；领域术语由 docs 下按目录归属的 `concepts.json` 拥有，写作政策由同目录的 `concord-writing.json` 拥有；测试定义与正向关系由测试源码拥有；工程 Memory 拥有自己的正文与生命周期历史。
2. 目录确定术语与政策的局部作用域，docs 根拥有全局定义。Markdown 解释关系与案例，不重复维护结构化定义。
3. 反向关系、聚合索引与引用反查从来源派生，不维护第二份登记表。
4. HawDB 只保存可重建投影与可丢弃缓存，短期解析使用同一引擎的内存实例。文件 owner、证据与发布日志不进入缓存。

<a id="c-002"></a>
## C-002 独立、本地、可安装

1. Concord 必须作为独立安装包在隔离 Git 消费者中工作，不依赖其它仓库的 checkout、全局安装、provider 凭据或部署服务。
2. 可选外部接入必须有明确边界，不成为基础本地流程的前提。

<a id="c-003"></a>
## C-003 写入遵守范围和恢复契约

1. 所有写入必须校验目标路径、前像与完整变更集，拒绝路径逃逸和 symlink 绕过。
2. 中断时必须保留可解释的恢复现场，不覆盖未知编辑。
3. 新增配置、来源和写入口必须同时定义资源所有权与恢复授权。

<a id="c-004"></a>
## C-004 证据只表达实际证明的范围

1. 源码声明不等于执行，命令成功收据不等于逐 case 覆盖或正式 E2E 可靠性。
2. Memory fixed 必须满足对应证据等级、当前身份和生命周期约束。
3. 文档、宪法结构或关系检查不得被展示为实现合规、功能完成或测试覆盖的证明。

<a id="c-005"></a>
## C-005 维护代码采用严格 TypeScript 与 Effect

1. 实现、测试和构建脚本采用严格 TypeScript，执行与副作用通过 Effect 组织。不添加手工维护的 JavaScript，不绕过类型检查；编译输出和 JavaScript 消费者兼容 fixture 除外。
2. Effect 依赖精确固定，使用 API 前读取安装包指引。不可信边界严格 Schema 解码并返回具名失败。
3. 唯一原生例外是 `native/hawdb`：Rust N-API 桥接、链接胶水、字节转换、预算执行与固定 revision 的目录所有权锁适配。领域决策、来源核验、测试和构建编排仍属 TypeScript/Effect。
4. 桥接、引擎、Rust toolchain 与依赖精确固定。持久句柄受来源快照生命周期管理，内存句柄按进程管理。发行包携带目标平台产物，消费者不需要 Rust、全局 HawDB 或数据库服务。锁协议与上游 revision 绑定，升级必须重新验证互斥与清理。
5. 本条约束 Concord 自身。接入项目的语言、包管理器和运行时由其自行选择。

<a id="c-006"></a>
## C-006 用产品自身管理和验收开发

1. 新功能先声明目标 Feature 与完整 Use Case，重要方案经 Design 比较和裁决。
2. 验收测试在声明旁关联契约。交付必须通过 `pnpm check`，通过构建与打包后的公开 CLI 在隔离 Git 消费者中验证。
3. Concord 的 check、trace 与 review 用于检查自身关系，不虚构测试关联或完成状态。

<a id="c-007"></a>
## C-007 尊重协作与外部操作授权

1. 保留其他任务的改动，控制写入范围。
2. 未经明确授权不得 push、发布、操作生产、调用付费模型或发送外部消息。
3. 破坏消费者兼容、改变持久数据含义、重划资源所有权或信任边界、回滚依赖协调迁移的方案，必须先完成独立设计挑战：由未参与方案的 reviewer 只读审查并给出书面结论，存在未解决的阻断意见时不得定案。

<a id="c-008"></a>
## C-008 宪法随功能经验明确修订

1. 功能规划、实施和审阅读取当前宪法。新发现的跨功能约束通过修订写入；功能专属细节留在对应契约。
2. 修订须按项目授权采用，说明适用范围、理由、来源和影响，由 `concord constitution amend` 在元数据中追加日期与修订记录，不覆盖既有历史。
3. 正文只维护当前规则，修订时直接改写，不追加相反规则，不声称已有功能自动满足新规则。
4. 条款身份由路径与 anchor 拥有，编号保持稳定，只追加不复用，不设版本号。修订后必须检查引用条款的 Feature 与 Design。

<a id="c-009"></a>
## C-009 运行时只接受当前格式

1. 普通运行时只接受当前格式的配置、owner 与 journal。检测到其它格式时返回具名迁移诊断，保留锁和事务现场，由显式离线迁移或恢复处理。
2. 缺少当前配置绑定的证据必须重新取证，不补字段或重算摘要伪装为当前证明。
3. 宪法读取允许当前 Schema 明确声明的受限输入投影；读取不写回，也不扩大写入或恢复授权。修订输出当前规范形式并保留修订历史；程序回退须使用匹配的文件与现场。
4. 本条约束格式边界，不改变领域数据的含义。

<a id="c-010"></a>
## C-010 接入项目采用 Concord 范式

1. Concord 规定一套软件项目工作范式，接入项目必须采用：统一契约布局；契约先于实现；每项事实一个 owner；`docs/` 只写声明（C-012）；测试与实现通过显式源码标记关联契约；工程过程进入 Memory 与 Issue；Problem 按证据关闭；写入遵守前像与恢复契约。
2. 不提供关闭事实归属、关系解释、生命周期、证据下限及安全写入不变量的配置。项目可以配置来源位置、执行适配、文档页面和写作规则参数，配置不得绕过已采用的不变量。
3. `concord check` 必须执行关系、生命周期及项目写作政策检查；检查失败或必需输入缺失时返回非零退出码，并区分违规与输入不完整。必查范围、必需规则与接入条件由[文档写作契约](feature/documentation-quality/README.md)声明；定向检查或独立 profile 的结果不能替代聚合门禁。聚合检查不成为局部读取和修复操作的前提。
4. 范式不规定技术栈。产品构建与部署、原生 runner、运行环境、语言与包管理器由接入项目拥有；通用模型不要求产品包名、私有 HTTP 接口、Nx metadata 或 host/provider 分类。可选执行能力缺失只阻断需要它的操作，不使静态契约与关联失效。
5. 项目与 Problem 已采用的证据要求是关闭结论的下限，不能通过换入口、删除配置或降级 command 证据绕过。基础 command 证据与按需采用的原生可靠性要求并存，范式不要求所有项目采用同一 runner 或最高证据等级。原生与可靠性结论由 Concord 统一核验；adapter 负责真实观察与资源终结。
6. 政策变更与跨仓库切换必须保留历史原件、互斥和恢复边界，不得形成并行授权域或降低既有证据要求。

<a id="c-011"></a>
## C-011 测试关联由源码标记拥有

1. 测试根中的 Concord 标记是测试关联的唯一正向来源，标记存在即关联存在。工具不解析宿主语言的测试声明、框架绑定、回调或 skip/todo。
2. JS/TS 仅用注释范围排除字符串和模板中的伪标记；其它文本文件接受以 `//`、`#` 或 `--` 开头的标记行。
3. 执行由接入项目的 runner 命令负责。没有显式 `@name` 时运行覆盖标记所在文件，不声称选中了某个原生用例。缺少逐 case 选择能力只限制选择性执行，不使标记关联失效。

<a id="c-012"></a>
## C-012 docs 只写声明，过程进入工具

1. `docs/` 的契约正文只声明目标、行为、约束、使用方法与验收要求，接入项目同样适用。产品操作流程、生命周期和验收步骤属于声明。实施日志、进度、待办、排障经过、测试运行记录、审阅与挑战经过、提交收据和 agent 交接不进入 `docs/`。
2. 约束用现行句式表达（“不提供 X”），只描述当前规则，不描述它与过去的差别，不点名已删除的接口、实现或文档。
3. 排障经过、根因和可复用经验归 Memory，待调查的观察归 Issue，正式采用的目标归契约。Research 的研究事实、Design 的候选与裁决，以及工具拥有的修订和生命周期元数据，由各自 owner 保留，不借此记录实施日志、审阅经过或交接。本规则不授权删除或改写既有证据、来源及生命周期历史。
4. Agent 对 Memory 与 Issue 的索引、检索、读取、创建、编辑、关联和生命周期操作必须通过 Concord CLI 或受管 API，不直接编辑 owner 文件、metadata 或 history，不维护人工 INDEX。工具缺口必须补齐或明确报告，不用手写文件绕过。
5. 本地 Issue 不依赖外部服务。远端写入需单独授权，本地操作不自动投射为远端变更。

<a id="c-013"></a>
## C-013 操作依赖、发布协调和证据裁决分别定义

1. 每个操作按目标与不变量声明所需输入。局部读取与精确引用验证不以无关 owner、代码或测试全部有效为前提；目标身份、来源、归属与路径安全仍须严格校验。
2. 全局诊断保留可读取记录和全部已发现错误。完整性随投影与关系输出传播，不完整输入不能授权依赖完整图的裁决。
3. 只读来源访问使用乐观快照并核验观察集合和发布代次；普通写入规划不持锁，提交使用短期独占协调与前像核验；dry-run 表达变更预览，与访问权限分别建模。未知 runner 清理状态阻断发布。
4. 恢复区分 journal 结果、实际回收 token 与 runner 状态，返回成功前核验恢复后的协调状态，不用无 journal 推断仓库整体可写。

<a id="c-014"></a>
## C-014 性能是交付约束

1. Concord 是 agent 高频调用的本地工具。高频公开操作必须具有由其契约 owner 声明的性能预算。[性能验收](engineering/concord-self-hosting/performance.md)统一声明参照环境、数据规模、冷暖状态、测量边界、采样方法及失败判据；超预算或缺少必需测量证据均不能判为通过。
2. 命令只读取完成目标所需的输入，不为只读操作加载无关子命令、启动无关进程或扫描无关 owner。所需输入包括安全、来源一致性及完整性验证所需的全部输入。
3. 优化前必须测量并定位瓶颈，优化后用同一方法复测；测量结果进入 Memory，预算与方法进入契约。不得为性能跳过摘要或 Schema 校验、路径安全、完整性门禁、授权检查，或缩减全局诊断范围。
4. 当前事实查询的缓存只加速，成功结果的领域事实与有效性判断必须与同源重建一致。明确声明为历史诊断或工作区导航的只读查询可读取带构建区间、来源一致性、完整性和刷新状态的投影；导航投影允许来源漂移，但须列出变化路径并将未知关系标为未知。该结果不表示当前来源有效，不得授权 check 成功、写入、恢复或证据裁决。声明只读缓存的工作台在缓存不可用时具名失败，不回退来源扫描。其它当前事实查询不返回陈旧或未经校验的成功结果。
