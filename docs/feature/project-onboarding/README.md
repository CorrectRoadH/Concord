
# 渐进式项目初始化与品味治理

## 问题与目标

维护者在任意 Git worktree 中不写配置即可使用 Concord：文档布局、发现范围与 Memory 位置都由约定决定，配置只用于 runner 与可选覆盖。项目品味是功能规划、实施与审阅共同遵守的规则来源；功能开发发现的通用约束通过明确修订进入品味。

## 已确认的需求

- `concord.config.ts` 可以不存在；存在时是静态 TS 数据，运行时只读取它，不执行配置模块。配置项与默认值见[维护项目配置](use-case/maintain-project-config.md#配置项)。
- 初始化提供渐进交互与等价的非交互输入，预览完整变更，取消不写入，保留已有文件。init 创建 draft 品味 `docs/taste.md`；根目录 `DESIGN.md` 是独立可选项。
- 品味文件存在即启用，`status` 决定是否已采用。
- 创建 Feature 时以参数选择页面：README 必需，其余页面可选。
- 初始化指引要求 Spec 声明目标，开发过程归 Memory。`docs/` 与 `memory/` 下的全部文件都可以直接编辑；Concord 命令执行需要运行的步骤，`check` 检查结果是否一致。
- 初始化在根 `AGENTS.md` 中维护有边界标记的 Concord 指引，保留区块外正文，并引导 coding agent 从已安装版本运行 `concord --skill` 按任务读取说明。
- Memory 固定位于 worktree 根的 `memory/`。
- Feature 可以推动品味新增、修订条款；理由、来源与影响记入以 `amends` 指向受影响条款的 Decision Memory，不把功能细节无限追加为全局规则。

## 边界

不生成其它框架的应用代码，不引入远端写入或自动多后端同步，不将文档存在或代码声明称为完整合规证明。

## 验收方式

使用打包后的公开 CLI 在隔离 Git 消费仓库中验证完整用户路径；真实测试声明关联本 Feature 的 Use Case。运行 `pnpm check`，并使用 Concord 的 check、trace 与 review 检查自身 Spec 关联。

## 性能预算

按[性能验收](../../engineering/concord-self-hosting/performance.md)的参照环境与七次采样判定，阈值为参照实测 p50 加约 20% 余量取整。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `project-onboarding/config` | 读取配置 | 670ms |
| `project-onboarding/doctor` | 接入诊断 | 5250ms |

## 接入项目采用的范式

以下规则约束使用 Concord 的消费仓库。

1. Concord 规定一套工作范式，接入项目必须采用：统一 Spec 布局；Spec 先于实现；每项事实一个 owner；`docs/` 只写声明（[页面职责](../../document-model.md#页面职责)）；测试与实现通过显式源码标记关联 Spec。工程过程进入 Memory 与 Issue；Issue 按关闭种类的规则关闭，fixed 经过修复核验；写入遵守前像与恢复 Spec。
2. 不提供关闭事实归属、关系解释、生命周期、证据下限及安全写入不变量的配置。项目可以配置来源位置、执行适配、文档页面和写作规则参数，配置不得绕过已采用的不变量。
3. `concord check` 必须执行关系、生命周期及项目写作政策检查；检查失败或必需输入缺失时返回非零退出码，并区分违规与输入不完整。必查范围、必需规则与接入条件由[文档写作的聚合门禁](../documentation-quality/gate.md)声明；定向检查或独立 profile 的结果不能替代聚合门禁。聚合检查不成为局部读取和修复操作的前提。
4. 范式不规定技术栈。产品构建与部署、原生 runner、运行环境、语言与包管理器由接入项目拥有；通用模型不要求产品包名、私有 HTTP 接口、Nx metadata 或 host/provider 分类。可选执行能力缺失只阻断需要它的操作，不使静态 Spec 与关联失效。
5. 关闭种类的要求是关闭结论的下限，不能通过换入口或删除配置绕过。修复核验由 Concord 统一执行；runner 与 adapter 负责真实执行与资源终结，范式不要求所有项目采用同一 runner。
6. 政策变更与跨仓库切换必须保留历史原件、互斥和恢复边界，不得形成并行授权域或降低既有关闭要求。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [总则](../../taste.md#general-amend)
- [写现在，不写过去](../../taste.md#t-4)
