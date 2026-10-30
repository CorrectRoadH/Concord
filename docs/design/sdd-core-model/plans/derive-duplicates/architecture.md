# derive-duplicates 架构

## 布局与身份

| 路径 | 类别 |
| --- | --- |
| `docs/feature/<f>/README.md` | Feature |
| `docs/feature/<f>/use-case/<u>.md` | Use Case，属于 `<f>` |
| `docs/feature/<f>/architecture.md` | 实现：实体归属、数据流、不变量、失败与资源生命周期 |
| `docs/feature/<f>/cli.md`、`library.md` | 示例：完整调用、`--json` 输出、退出码与错误；库为签名与返回值 |
| `docs/feature/<f>/` 下其它页面 | 支持页面 |
| `docs/engineering/<t>/` | Engineering，页面结构同 Feature |
| `docs/roadmap/<r>/` | 提案，页面结构同 Feature |
| `docs/design/<d>/`、`docs/research/<r>/` | Design 与 Research |
| `docs/issues/<i>.md`、`memory/<m>.md` | Issue 与 Memory |
| `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 项目规则 |

身份是 canonical 仓库相对路径。短选择器（Feature 目录名、Use Case 文件名、Issue 与 Memory 文件名）在同类别中歧义时具名拒绝，例如两个 Feature 都有 `use-case/create.md` 时，`show create` 要求写出路径。名称保留 Unicode 原拼写与组合标记，大小写与 Unicode 规范化碰撞沿用现行路径保护。名称取自正文唯一的一级标题，按 Markdown 语法树识别，代码块中的标题不计。

frontmatter 中的路径值一律是仓库相对路径。

## 字段

Spec、提案、Research 与 Design 没有 frontmatter。Research 的观察日期与来源写在正文的「来源」小节，格式由写作模板固定。Design 的候选来自 `plans/` 子目录，裁决由 `design decide` 校验全部候选与 Limits 后写入 DECISION 的 `Selected:` 行；直接编辑该行时 `check` 用同一规则校验。

宪法：

```yaml
status: active   # draft 或 active
```

Issue（字段只在非空时出现）：

```yaml
status: open
relations:
  - role: root-cause             # 角色与目标类型见下表
    target: memory/token-race.md
source: {...}                    # 沿用现行 FeedbackSource Schema
closure:
  kind: fixed
  reason: 修正锁顺序
  verification: {...}            # 仅 fixed，见修复核验
```

| 角色 | 目标 | 含义 |
| --- | --- | --- |
| `investigation`、`root-cause`、`decision` | current 或 superseded 的 Memory | 调查记录、根因、所依据的决策 |
| `adopts` | Feature、Use Case 或 Engineering 的路径或锚点 | 该 Issue 当前被这条 Spec 承接；退役即删除这一项，历史在 Git |
| `duplicate-of` | 另一个 Issue | 由 `closure: duplicate` 写入，不得成环 |

`source` 沿用现行 [FeedbackSource](../../../../feature/feedback/architecture.md) 的完整字段，本页示例不穷尽。字段包括 GitHub 与 Linear 的去重键与首次来源摘录。`closure` 的种类与必需字段沿用[本地观察](../../../../feature/feedback/use-case/manage-local-observations.md)的现行规则。delivered 的 target 必须是当前 `adopts` 之一并带 proof。duplicate、declined 与 invalid 先删除全部 `adopts`，declined 指向 current 的 Decision。external-fixed 带 dependency、version 与 proof。fixed 的要求见下文。

Memory（字段只在非空时出现）：

```yaml
type: decision         # decision、insight、note
status: current        # captured、current、superseded；note 只能是 captured
relations:
  - role: supports     # 支持一条 Spec；或 amends，指向宪法条款与款
    target: docs/feature/login/README.md#token
supersededBy: memory/new.md     # 或 supersession 写明原因与来源
```

宪法每次 adopt 与 amend 写一条 `type: decision` 的 Memory，以 `amends` 关系指向受影响的条款与款；按条款检索修订从这些关系派生。

### 直接编辑与门禁

人与 agent 直接编辑全部文件，包括 Issue 的状态与关闭结论、Memory 的状态与关系、DECISION 的 `Selected:` 行与宪法正文。具名命令（`issue close`、`memory activate`、`design decide`、`constitution amend`、`roadmap adopt` 等）是写入同样内容的助手：它们执行需要运行的步骤（例如修复核验）并把结果写进文件，但不是唯一的写入途径。

可信度由门禁保证。`concord check` 校验当前状态；`concord check --since <base>` 另外对照基线提交检查本次变化，CI 对每个变更运行它：

| 变化 | 检查 |
| --- | --- |
| Issue 新增或修改 fixed 的 `verification` | 按记录重放修复核验，失败或无法重放即报告 |
| Issue、Memory 的状态改变 | 转换合法：例如 note 不能成为 current，closed 必须带完整的关闭结论 |
| active 宪法的条款或款改变 | 本次变化中有一条 `type: decision` 的 Memory 以 `amends` 指向它们 |
| DECISION 的 `Selected:` 改变 | 按 `design decide` 的规则校验全部候选与 Limits |
| Roadmap 移入 `docs/feature/` | 链接改写与采用规则满足 |

Web 工作台的保存使用整文件摘要，只用于防止覆盖并发的外部编辑，不是授权边界。

## 修复核验

只支持线性路径：先提交会失败的回归测试，再提交修复。

1. 回归测试用标记 `@issue docs/issues/<i>.md` 指向它守护的 Issue。`concord issue close <i> --fixed` 要求工作树干净，修复候选即当前 HEAD；不经该命令直接写入的 `verification` 由 `check --since` 重放核验。
2. 缺陷候选默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交，所有回归测试必须在同一提交中首次出现，否则需要 `--defect` 显式指定；`--defect` 必须是 HEAD 的 first-parent 祖先。
3. 从缺陷候选到 HEAD 之间，测试文件、runner 配置、`runner.sourceFiles` 与测试指向的 Spec 字节不变，只允许其它文件变化；区间中有 merge 提交时不支持。
4. 在 Git-private 目录 `verify/<i>/` 下以 detached worktree 检出缺陷候选，在主工作树运行修复候选；两次运行都在现行 runner 租约与 OwnedProcess 下执行，结束后删除临时 worktree，清理无法确认时按现行 runner 阻断处理。
5. 缺陷候选上 runner 以非零码结束，修复候选上以零结束。command runner 不区分断言失败与构建失败，这一限制如实记录；缺测试、缺提交（含 shallow clone）、同一提交同时加入测试与修复、超时都是 `FixUnverifiable`。
6. 发布前重新核对 HEAD、工作树、配置与 Issue 前像，变化则拒绝。写入的 `verification` 包含缺陷与修复提交、按现行测试关联 ID 列出的回归测试、runner 配置摘要与执行它的 Concord 版本。

`check` 报告 fixed 但没有 `verification`、提交不存在或测试不再指向该 Issue。`concord test verify <i>` 按记录重放：在两个提交各自的 detached worktree 中运行，前提是提交、依赖与运行环境可获得，不满足时报告无法重放，不改变已记录的结论。reopen 删除 `closure`，状态回到 open。

## 退休的能力

以下现行能力明确删除，宪法同时修订：

| 能力 | 理由 | 影响 |
| --- | --- | --- |
| Git-private command 收据与 Memory Problem 的 epoch | 收据不随仓库共享，新 clone 不可见；修复结论改为 Issue 中可审计的提交级核验 | 已有收据原地保留、不读取 |
| repository profile 的正式可靠性治理（八个 invocation、可靠性观察、政策下限） | 依赖被删除的 Problem、epoch 与收据；只服务于来源项目的正式 E2E | `concord repo` 的治理入口删除；profile 原件原地保留、不读取 |
| 多个 Memory 来源与只读来源 | 固定为 `memory/`，减少配置与归属判断 | 外部只读 Memory 需复制进仓库或不再纳入 |
| `documentDefaults` 与 `projectTypes` | 创建时以参数选择页面 | 每次创建需要选择页面；README 必需，其余可选 |

## 配置

`concord.config.ts` 可以不存在。

| 项 | 默认 | 何时配置 |
| --- | --- | --- |
| `runner` | 无 | 需要 `test run` 或修复核验时 |
| `testRoots` | 存在的 `test/`、`tests/` | 测试在其它位置 |
| `sourceRoots` | 存在的 `src/` | 实现在其它位置 |
| `sourceIgnore` | 无；另外始终排除 `.env`、`.env.*` 与 `dist` | vendor、生成文件 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5`、`docsWork` | 无 | 按需 |

删除的配置项：`format`；`projectId`，工作区身份取 root 与 Git-private 目录，配置快照仍绑定原文摘要；`constitution`，文件存在即启用，status 决定是否采用；以及退休能力表中的项。

发现范围、runner 输入与 Web 的源码写入范围分别定义；默认值不扩大 Web 的写入范围。

## 改写

一次性脚本，不进入产品：

- 删除 Spec、提案、Research 与 Design 的 frontmatter；Research 的观察日期与来源移入正文。
- 宪法 frontmatter 只留 `status`。
- Issue 按上表改写：`memoryRelations` 改为同角色的 `relations`；`adoptions.current` 改为 `adopts` 关系；`adoptions.history` 与 `history` 删除，历史在 Git；空字段删除。
- 每个 Memory Problem 改写为 Issue，指向它的关系同时改指新 Issue；已记录的 fixed 结论写为 closure，没有 verification，由 `check` 报告并等待重新核验。Memory 的其它类型改为 `type`、`status` 与 `relations`（promotion 改为 `supports`）。
- Roadmap 采用改为移动目录，链接改写、目标冲突与并发变化沿用现行的原子采用规则。
- `lifecycle.md` 并入所在 Feature 的 `architecture.md`。
- Git-private 收据原地保留，不读取、不删除。

## 验证

- Cases C1–C9 在打包 CLI 的隔离消费者中执行。
- 修复核验：同一提交加入测试与修复时，默认 defect 为该提交，核验报 `FixUnverifiable` 并提示用 `--defect` 指向修复前的提交；多提交修复、merge、squash 后的提交、shallow clone 分别有确定结果。
- 本仓库改写后 `check` 无 finding；`trace` 的关系按类型与精确端点逐项与改写前对照，变化只来自本页规定的映射。
- 修复核验的拒绝场景：只改 runner 输入、历史修复提交、同一提交加入测试与修复、区间含 merge、shallow clone、运行后 HEAD 变化。
- 受管保存的拒绝场景：经 save 写入 status、relations 或 verification，改写已裁决的 `Selected:`，修改 active 宪法正文。
