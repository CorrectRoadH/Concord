# 领域与数据所有权

## Owner

文档按回答的问题与生命周期分为下列类别，身份、类别、所属关系与名称由路径和一级标题推导，只有推导不出的语义保存在 frontmatter。

| 路径 | 类别 | frontmatter |
| --- | --- | --- |
| `docs/feature/<f>/README.md` | Feature | 无 |
| `docs/feature/<f>/use-case/<u>.md` | Use Case，属于 `<f>` | 无 |
| `docs/feature/<f>/architecture.md` | 实现：实体归属、数据流、不变量、失败与资源生命周期 | 无 |
| `docs/feature/<f>/cli.md`、`library.md` | 示例：完整调用、`--json` 输出、退出码与错误；库为签名与返回值 | 无 |
| `docs/feature/<f>/` 下其它页面 | 支持页面 | 无 |
| `docs/engineering/<t>/` | Engineering，页面结构同 Feature | 无 |
| `docs/roadmap/<r>/` | 提案：尚未采用的方向，页面结构同 Feature | 无 |
| `docs/design/<d>/` | Design：候选比较与正式选择 | 无 |
| `docs/research/<r>/` | Research：带来源与观察时间的研究输入 | 无 |
| `docs/issues/<i>.md` | Issue：缺陷、请求与观察 | 见下文 |
| `memory/<m>.md` | Memory：可复用知识与不需要 Design 的决策 | 见下文 |
| `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 项目规则 | 品味只有 `status` |

- canonical 仓库相对路径是唯一身份。移动文件即改变身份，`check` 报告全部失效的精确引用。
- Feature 目录名、Use Case 文件名、Issue 与 Memory 文件名是短选择器。同一类别中歧义时具名拒绝，例如两个 Feature 都有 `use-case/create.md` 时，`show create` 要求写出路径。
- 名称取自正文唯一的一级标题，可以与路径名不同。标题按 Markdown 语法树识别，代码块中的标题不计；名称保留 Unicode 原拼写与组合标记。
- 普通正文链接只是导航。frontmatter 中的路径值一律是仓库相对路径，字段只在非空时出现。
- Research 的观察日期与来源写在正文标题为 `## Sources` 或 `## 来源` 的小节，格式由写作模板固定。Design 的候选来自 `plans/` 的直接子项，裁决写在 DECISION 的 `Selected:` 行，见[逐项比较方案并明确裁决](use-case/compare-design-plans.md)。
- 品味的 `status` 取 `draft` 或 `active`，是采用授权的边界，见[演进品味](../project-onboarding/use-case/evolve-constitution.md)。

创建时间、采用来源与修订历史由 Git 提供（[只写当前声明](../../document-model.md#只写当前声明)）。测试源码拥有 case 身份和正向关系。

### Issue

```yaml
status: open
relations:
  - role: root-cause
    target: memory/token-race.md
source: {...}
closure:
  kind: fixed
  reason: 修正锁顺序
  verification: {...}
```

| 角色 | 目标 | 含义 |
| --- | --- | --- |
| `investigation`、`root-cause`、`decision` | current 或 superseded 的 Memory | 调查记录、根因、所依据的决策 |
| `adopts` | Feature、Use Case 或 Engineering 的路径或锚点 | 该 Issue 当前被这条 Spec 承接；不再承接时删除这一项 |
| `related` | 另一个 Issue | 两个 Issue 相关，例如一个观察的缺陷由另一个 Issue 跟踪 |

缺陷只在 Issue 中跟踪。`source` 是远端来源的稳定身份，字段见[反馈来源](../feedback/architecture.md)。`closure` 的种类与必需字段见[本地观察](../feedback/use-case/manage-local-observations.md)；fixed 的 `verification` 见[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)。

### Memory

```yaml
type: decision
status: current
relations:
  - role: supports
    target: docs/feature/login/README.md#token
supersededBy: memory/new.md
```

- `type` 取 `decision`、`insight` 或 `note`。Memory 不重复 Design 的结论。
- `status` 取 `captured`、`current` 或 `superseded`；note 只能是 captured。
- `supports` 指向一条当前 Spec 或其锚点；`amends` 指向整份品味（`docs/constitution.md`，用于采用）或其条款与款（`docs/constitution.md#c-NNN[-K]`）。
- 被替代时写 `supersededBy`；替代目标不在仓库中时写 `supersession`，说明原因与来源。

## 派生关系

`@feature` 或 `@use-case` 用 canonical 路径指向对应 Spec，`@issue` 可重复指向回归测试守护的 Issue。每个标记块恰有一个 Spec 目标，同一 Spec 可有多个测试。执行引用由文件路径与测试名称自动派生，测试名称只描述行为，不携带机器 ID；不提供人工分配 ID 或先分配再关联的步骤。Spec 不反写测试列表，trace 每次从 owner 和源码重新编译反向关系。Issue 与 Memory 的正向关系只保存一次，反向关系派生。

## 关联身份与观察

| 身份 | 形式 | owner |
| --- | --- | --- |
| 步骤 | `<use-case path>#<step-id>`，见[步骤语法](use-case/link-tests-to-steps.md#步骤语法) | Use Case 正文 |
| 测试关联 | `concord.test-reference/v1`：文件加 `@name`，或文件加 Spec 目标与标记序号 | 测试源码标记 |
| 代码关联 | JS/TS 为 `concord.code-reference/v1` 派生引用；其它语言为 canonical 文件路径加文件内标记块序号 | 代码声明 |
| 原生选择 | adapter 观察到的原生 ID 集合 | 无，执行时观察 |

前三种身份不随缓存变化；原生选择只影响执行。带 `@name` 的标记改变 Spec 目标时测试关联 ID 不变。原生选择与 symbol locator 不进入关联身份；原生清单是否存在不改变 case 集合、case ID 或 `check` 的关系结论。原生标签（pytest mark、JUnit Tag 等）只作展示元数据，标签中的 Spec 字符串不创建关联，也不参与引用校验。

原生清单、依赖分析与相关性判定返回同一观察结构：`value`、`inputs`（全部实际输入的摘要，含实现与版本）、`complete`、`gaps`（`complete` 为 false 时的具名原因）、`observedAt` 与 `current`（输入摘要与当前源码一致）。

- 只有 `test discover`、`code analyze` 与 `test run` 的执行前收集产生观察；其它命令与编辑器服务只读取。
- 观察可丢弃。`check` 的退出码、finding 与 `complete` 不读取观察，冷缓存、热缓存、缓存损坏与清空后结论相同。
- `current` 为 false 的观察只作历史展示，带来源与时间，不用于选择执行或相关性判定。

相关性判定只报告观察到的正向交集，不输出“无关”结论：

| 结果 | 含义 |
| --- | --- |
| `observed` | 测试依赖中观察到声明实现目标的代码，带 `level`：`step`、`use-case` 或 `feature`；文件范围的结果同时带 `FileScope` |
| `not-observed` | 未观察到这样的代码，总带 `gaps`，例如 `FileScope`、`DepthLimit`、`NoSourceImports`、`SubprocessBoundary`、`NoAnalyzer`、`SnapshotNotCurrent` |

`not-observed` 不表示测试与 Spec 无关；CLI、review 与工作台写作“未观察到交集”并列出原因。只观察到其它 Feature 或同 Feature 另一 Use Case 的实现也不推出无关。判定不产生 finding，不改变退出码，关联与观察都不证明执行、断言正确或覆盖率，不用于修复核验。文件级 import 只能证明文件中的声明交集，不证明该文件每个 case 都调用了实现。

## 私有状态

Git-private 目录由 `git rev-parse --git-path concord` 定位，其中的 HawDB 缓存、journal、runner 租约与修复核验的临时 worktree 属于当前 worktree。普通单 worktree 仓库通常落在 `.git/concord`，linked worktree 则使用自己的 Git-private 路径。缓存可清除重建；journal 只用于安全恢复，不取代 Markdown 或测试源码。私有目录中的其它文件不被读取，也不被删除。

## 边界

所有不可信 JSON、YAML 和缓存内容必须严格解码。路径拒绝绝对路径、traversal 与 symlink 逃逸，读取检查的实现见[路径安全](architecture.md#路径安全)。修复核验只证明 runner 在两个提交上的退出结果，不继承任何产品专属 E2E 可靠性声明。

## 关联由源码声明拥有

测试与实现的关联由源码中的标记和代码声明拥有，指向最小完整范围（[一件事只写一次，其余推导](../../constitution.md#c-019)）。

1. 测试根中的 Concord 标记是测试关联的唯一正向来源，标记存在即关联存在。静态关联扫描不解析宿主语言的测试声明、框架绑定、回调或 `skip`/`todo`。执行时的原生收集、绑定与选择仅按 [关联由源码声明拥有](#关联由源码声明拥有) 进行，其观察结果不创建关联，也不授权静态关系检查成功。
2. 实现关联的唯一正向来源是通过语法、作用域、位置与目标校验的显式代码声明。未通过校验的标记产生 finding，不建立关联。反向关系从测试标记与代码声明派生。
3. 测试与实现指向能完整、准确描述该测试断言或该声明职责的最小既有 Spec 范围。测试可以指向 Feature 或 Use Case owner、Use Case 步骤，以及它们的附页或标题 anchor；实现还可以指向 Engineering owner 及其附页。对使用者可观察的保证先写进行为页再关联。只服务内部不变量的代码与测试，指向所属 Feature 的 architecture 或 lifecycle 页的 anchor；仓库维护机制的代码指向 Engineering。跨步骤的完整断言指向整个 Use Case，一个声明服务多项行为时使用多个 implements。没有合法目标的测试不建立关联，不为此伪造产品步骤。
4. 代码侧选择完整且受支持的语义范围。整个文件服务同一职责且没有更精确的适用目标时，使用文件级声明。不为追求更窄而拆分实现、复制测试或机械改名步骤。缺少逐步骤关联不说明缺少执行或覆盖。
5. JS/TS 仅用注释范围排除字符串和模板中的伪标记；其它文本文件接受以 `//`、`#` 或 `--` 开头的标记行。
6. 执行由接入项目的 runner 命令或显式配置的 adapter 负责。adapter 可以仅在显式收集或执行前，把源码标记绑定到观察到的原生用例集合，或使用源码标记中的显式原生选择参数。原生选择不参与关联身份，不产生关联，不使静态检查依赖观察。只有能力和当前输入足以证明精确选择时，才声明选中了原生用例；否则执行范围按文件明确展示，要求原生精确选择的操作具名失败。缺少逐用例选择能力不使源码关联失效。
