# derive-duplicates 命令与工作方法

## 命令面

| 命令 | 作用 |
| --- | --- |
| `init` | 创建布局、`AGENTS.md` 区块与可选配置 |
| `new <类别> <名称>` | 按模板创建 Feature、Use Case、Engineering、提案、Design、Research、Issue 或 Memory |
| `show <路径或选择器>` | 一个文档及其关系、测试与实现 |
| `list [类别]` | 列出文档；`--open` 列出打开的 Issue |
| `check` | 放置、关系、概念、写作、修复核验记录 |
| `trace` | 关系图与缺口 |
| `test` | `list`、`run`、`verify <issue>` |
| `issue` | `close`（fixed 时先核验）、`reopen`、`link`（写入带角色的关系） |
| `memory` | `supersede` |
| `design` | `decide`、`defer` |
| `roadmap` | `adopt`（移入 `docs/feature/`） |
| `constitution` | `show`、`adopt`、`amend` |
| `concepts`、`writing` | 概念与写作政策的查看与受管写入 |
| `feedback` | 外部来源的同步与导入 |
| `view`、`panel` | Web 工作台与终端面板 |
| `save <路径> --expected-digest` | 受管保存，供 Web、action 与脚本复用 |
| `cache`、`recover`、`doctor`、`lsp`、`review`、`action` | 维护与集成 |

顶层共 24 个命令：日常 18 个，维护与集成 6 个。删除：`author`、各类 `page`、`feature`/`use-case`/`engineering`/`research` 的创建子命令（并入 `new`），以及 Memory 的全部生命周期子命令，`supersede` 除外。

## 工作方法

1. 写 Spec：Feature 的 README 写能力，Use Case 写用户路径与验收，architecture 写实现，cli 或 library 写示例。尚未决定做的方向写在 `docs/roadmap/`，决定后 `roadmap adopt`。
2. 有取舍时写 Design，`design decide` 裁决，采用的规则写进 architecture 页。
3. 实现与测试带标记；每条验收至少一个测试。
4. `check` 无 finding，测试通过，`trace` 的缺口都有打开的 Issue。
5. 缺陷写 Issue；先提交失败的回归测试，再提交修复，`issue close --fixed` 核验后关闭。经验写 Memory。
