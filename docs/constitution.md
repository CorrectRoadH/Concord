---
format: concord.constitution/v1
status: active
ratifiedAt: 2026-09-14
amendedAt: 2026-09-23
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
---

# Concord 项目宪法

本宪法汇总仓库已经采用的工程约束。具体功能细节由 Feature/Use Case 拥有，方案比较与裁决由 Design 拥有。

<a id="c-001"></a>
## 事实只由自己的来源维护

契约正文由 Markdown owner 拥有；领域术语的结构化定义由 docs 下按目录归属的 concepts.json 拥有，写作政策由同目录的 concord-writing.json 拥有。目录确定局部作用域，docs 根拥有全局定义；Markdown 解释关系与案例，不重复维护结构化定义。术语与政策的目录扫描、聚合索引及引用反查均从来源派生，不维护第二份登记表。测试定义和正向关系由实际测试源码拥有，工程 Memory 拥有自己的正文与生命周期历史。HawDB 只保存可重建投影与可丢弃缓存；短期解析也使用同一引擎的内存实例。文件 owner、证据与发布日志不迁入缓存。

来源：AGENTS.md、docs/architecture.md。

<a id="c-002"></a>
## 独立、本地、可安装

Concord 必须可作为独立安装包在隔离 Git 消费者中使用，不依赖 NiceEval checkout、全局安装、provider 凭据或部署服务。可选外部接入必须有明确边界，不成为基础本地流程的隐含前提。

来源：AGENTS.md、docs/provenance.md。

<a id="c-003"></a>
## 写入遵守范围和恢复契约

所有写入必须校验目标路径、前像与完整变更集，拒绝路径逃逸和 symlink 绕过。发生中断时保留可解释的恢复现场，不覆盖未知编辑。新增配置、来源和写入口必须同时定义资源所有权与恢复授权。

来源：docs/architecture.md。

<a id="c-004"></a>
## 证据只表达实际证明的范围

源码声明不等于执行，命令成功收据不等于底层逐 case 覆盖率或正式 E2E 可靠性。Memory fixed 必须遵守对应证据等级、当前身份和生命周期约束。文档或宪法结构检查不得被展示为实现已经合规。

来源：AGENTS.md、docs/architecture.md。

<a id="c-005"></a>
## 维护代码采用严格 TypeScript 与 Effect

实现、测试和构建脚本采用严格 TypeScript，执行与副作用通过 Effect 组织。不添加手工维护的 JavaScript 脚本，不绕过类型检查；编译输出和明确的 JavaScript 消费者兼容 fixture 除外。Effect 依赖保持精确固定版本，使用 API 前读取安装包指引；不可信边界严格 Schema 解码并返回具名失败。

唯一原生例外是 native/hawdb 下嵌入 HawDB 所需的 Rust N-API 桥接、必要链接胶水、字节转换、预算执行与固定 revision 的目录所有权锁适配。领域决策、来源核验、测试和构建编排继续采用 TypeScript/Effect；不以例外扩展为另一套业务实现。桥接、引擎、Rust toolchain 与依赖精确固定，持久句柄受短快照生命周期管理，无磁盘缓存句柄按进程管理。发行包携带目标平台产物，消费者无需 Rust、全局 HawDB 或数据库服务。锁协议与上游 revision 绑定，升级须重新验证互斥与清理。

来源：AGENTS.md。

<a id="c-006"></a>
## 用产品自身管理和验收开发

新功能先记录目标 Feature 与完整 Use Case，重要方案通过 Design 比较和裁决。真实验收测试在声明旁关联契约；交付运行 pnpm check，通过构建与打包后的公开 CLI 在隔离 Git 消费者验证。Concord 的 check、trace 与 review 用于检查自身关系，不能虚构测试关联或完成状态。

来源：AGENTS.md、本轮用户的 dogfood 要求。

<a id="c-007"></a>
## 尊重协作与外部操作授权

保留其他任务改动，控制写入范围。未经明确授权不 push、发布、操作生产、调用付费模型或发送外部消息。重大兼容、持久数据、资源所有权、信任边界与不可独立回滚的方案，按仓库协作规则完成独立设计挑战后采用。

来源：AGENTS.md。

<a id="c-008"></a>
## 宪法随功能经验明确修订

功能规划、实施和审阅读取当前宪法。新发现的跨功能约束可以提出条款修订，必须说明适用范围、理由、来源和影响；功能专属细节保留在对应契约。按项目授权采用具体修订，保留日期、理由、来源、影响与追加历史，不能默默追加相反规则或声称旧功能自动满足新规则。条款身份由路径和 anchor 拥有，修订不要求版本号。

来源：docs/feature/project-onboarding/README.md。

<a id="c-009"></a>
## 旧格式通过显式离线迁移升级

普通运行时仅接受当前格式，不保留旧配置、owner 或 journal 的兼容授权。检测旧项目或历史事务时返回具名迁移诊断，保留锁和事务现场，由显式离线迁移或恢复处理。缺少当前配置绑定的旧证据必须重新取证，不补字段或重算摘要伪装为当前证明。本条约束运行时格式边界，不改变现有领域数据的含义。宪法旧版本字段仅作为受限读取兼容输入；读取不改写历史，授权修订后移除版本字段。旧程序无法读取新宪法文件，回退程序前须恢复对应历史文件。

来源：用户无 legacy 要求、docs/design/ts-only-runtime/README.md。

<a id="c-010"></a>
## 强制中立治理，产品执行由消费者拥有

Concord 面向软件项目规定唯一事实来源、统一契约布局、显式实现和测试关联、工程记忆生命周期、证据解释与安全变更。接入项目适配这些规范；规范的价值由其治理目的决定，不因最初来自某个项目而弃用。

产品构建与部署、原生 runner、运行环境及调度通道由消费者拥有。通用治理模型不能要求产品包名、私有 HTTP 接口、Nx metadata 或 host/provider 分类。可选执行能力的缺失只阻断需要该能力的操作，不使静态契约与关联失效。

项目与 Problem 已采用的证据要求是关闭结论的下限，不能通过换入口、删除配置或降级 command 证据绕过。原生与可靠性结论由 Concord 统一核验事实；adapter 负责真实观察与资源终结。政策变更及跨仓库切换必须保留历史、互斥和恢复边界。Concord 自身的 TypeScript、Effect 与 pnpm 工程约束不自动成为消费者的技术栈要求。

来源：用户 2026-09-20 授权、docs/feature/neutral-project-governance/README.md、docs/design/neutral-project-governance/README.md。

<a id="c-011"></a>
## 测试关联由源码标记拥有，不解析宿主测试语法

测试根中的 Concord 标记是测试关联的唯一正向来源。标记存在即表示该测试关联存在；工具不解析宿主语言的测试声明、框架绑定、回调或 skip/todo。JS/TS 仅用注释范围排除字符串和模板中的伪标记。其它文本文件接受以 `//`、`#` 或 `--` 开头的标记行。

执行仍由消费者的 runner 命令负责。没有显式 `@name` 时，运行覆盖标记所在文件，不声称选中了某个原生用例。缺少逐 case 选择能力只限制选择性执行，不使标记关联失效。

来源：用户 2026-09-22 授权、docs/constitution.md#c-010、docs/architecture.md。


<a id="c-012"></a>
## 契约声明目标，工程知识通过工具维护

产品与工程契约正文声明目标、行为、约束和验收条件，不承载开发日志、排障流水账、实施进度或临时执行计划。产品操作流程、生命周期与验收步骤是行为契约，可以保留。Research 的研究事实、Issue 的观察来源及工具维护的决策和生命周期历史由各自 owner 保留，不因目录名称被改写为实现进度。

排障经过、根因和可复用经验归工程 Memory，待调查的观察归 Issue，正式采用的目标归契约。Agent 对 Memory/Issue 的索引、检索、读取、创建、作者更新、关联和生命周期操作必须通过 Concord CLI 或共用受管 API；不直接编辑 owner 文件、metadata、history，也不维护人工 INDEX 或另一份关系登记表。工具缺口须补齐或明确报告，不能用手写文件绕过。

本地 Issue 不依赖外部服务。Local、GitHub、Linear 可以统一展示来源，但远端写入仍需单独授权；本地操作不得自动投射为远端变更。此规则约束工具工作流，不宣称操作系统阻止用户编辑文件，也不把已有历史材料批量重写。

来源：用户 2026-09-23 要求、docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md、docs/feature/feedback/use-case/manage-local-observations.md。
