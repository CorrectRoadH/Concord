
# 渐进式项目初始化与宪法治理

## 问题与目标

维护者在任意 Git worktree 中不写配置即可使用 Concord：文档布局、发现范围与 Memory 位置都由约定决定，配置只用于 runner 与可选覆盖（[决策依据](../../design/sdd-core-model/DECISION.md)）。项目宪法是功能规划、实施与审阅共同遵守的规则来源；功能开发发现的通用约束通过明确修订进入宪法。

## 已确认的需求

- `concord.config.ts` 可以不存在；存在时是静态 TS 数据，运行时只读取它，不执行配置模块。配置项与默认值见[维护项目配置](use-case/maintain-project-config.md#配置项)。
- 初始化提供渐进交互与等价的非交互输入，预览完整变更，取消不写入，保留已有文件。init 创建 draft 宪法 `docs/constitution.md`；根目录 `DESIGN.md` 是独立可选项。
- 宪法文件存在即启用，`status` 决定是否已采用。
- 创建 Feature 时以参数选择页面：README 必需，其余页面可选。
- 初始化指引要求 Spec 声明目标，开发过程归 Memory。`docs/` 与 `memory/` 下的全部文件都可以直接编辑；Concord 命令执行需要运行的步骤，可信度由 `check --since <base>` 门禁保证。
- 初始化在根 `AGENTS.md` 中维护有边界标记的 Concord 指引，保留区块外正文，并引导 coding agent 从已安装版本运行 `concord --skill` 按任务读取说明。
- Memory 固定位于 worktree 根的 `memory/`。
- Feature 可以推动宪法新增、修订条款；理由、来源与影响记入以 `amends` 指向受影响条款的 Decision Memory，不把功能细节无限追加为全局规则。

## 边界

不生成其它框架的应用代码，不引入远端写入或自动多后端同步，不将文档存在或代码声明称为完整合规证明。

## 验收方式

使用打包后的公开 CLI 在隔离 Git 消费仓库中验证完整用户路径；真实测试声明关联本 Feature 的 Use Case。运行 `pnpm check`，并使用 Concord 的 check、trace 与 review 检查自身 Spec 关联。

## 性能预算

按[性能验收](../../engineering/concord-self-hosting/performance.md)的参照环境与七次采样判定，阈值为参照实测 p50 加约 20% 余量取整。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `project-onboarding/config` | 读取配置 | 670ms |
| `project-onboarding/constitution` | 读取宪法及引用 | 880ms |
| `project-onboarding/doctor` | 接入诊断 | 5250ms |

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
- [C-012](../../constitution.md#c-012)
- [C-002](../../constitution.md#c-002)
