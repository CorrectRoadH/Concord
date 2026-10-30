# derive-duplicates 命令与工作方法

## 命令面

| 命令 | 作用 |
| --- | --- |
| `init` | 创建布局、`AGENTS.md` 区块与可选配置 |
| `new <类别> <名称>` | 按模板创建 Feature、Use Case、Engineering、提案、Design、Research、Issue 或 Memory |
| `show <路径或选择器>` | 一个文档及其关系、测试与实现 |
| `list [类别]` | 列出文档；`--open` 列出打开的 Issue |
| `check` | 放置、关系、概念、写作与修复核验记录；`--since <base>` 另外检查本次变化，见 architecture 的门禁表 |
| `trace` | 关系图与缺口 |
| `test` | `list`、`run`、`verify <issue>` |
| `issue` | `close`（fixed 时先核验）、`reopen`、`link`、`unlink` |
| `memory` | `activate`、`supersede`、`link` |
| `design` | `decide`、`defer` |
| `roadmap` | `adopt`（移入 `docs/feature/`） |
| `constitution` | `show`、`adopt`、`amend` |
| `concepts`、`writing` | 概念与写作政策的查看与受管写入 |
| `docs` | `docs check` 与 `docs work` |
| `feedback` | 外部来源的同步与导入 |
| `view`、`panel` | Web 工作台与终端面板 |
| `cache`、`recover`、`doctor`、`lsp`、`review`、`action` | 维护与集成 |

`docs work` 保留在 `docs` 下。顶层共 24 个命令：日常 18 个（含 `docs`），维护与集成 6 个。全部文件都可以直接编辑，命令是执行需要运行的步骤的助手。删除：`author`、各类 `page`、`feature`/`use-case`/`engineering`/`research` 的创建子命令（并入 `new`）、`repo`，以及 Memory 中解决、重开、晋升与退役晋升的子命令。

## 工作方法

1. 写 Spec：Feature 的 README 写能力，Use Case 写用户路径与验收，architecture 写实现，cli 或 library 写示例。尚未决定做的方向写在 `docs/roadmap/`，决定后 `roadmap adopt`。
2. 有取舍时写 Design，`design decide` 裁决，采用的规则写进 architecture 页。
3. 实现与测试带标记；每条验收至少一个测试。
4. `check` 无 finding，测试通过，`trace` 的缺口都有打开的 Issue。
5. 缺陷写 Issue；先提交失败的回归测试，再提交修复，`issue close --fixed` 核验并写入结论。经验直接写进 `memory/`。CI 运行 `check --since <base>`。

## 维护动作的步骤

| 动作 | 现行 | 本候选 |
| --- | --- | --- |
| 新增 Feature | `feature create` 生成带 frontmatter 的文件，再写正文 | 直接创建目录与 README |
| 修改验收 | 编辑正文，不得改动工具维护的 frontmatter | 直接编辑 Use Case |
| 修复缺陷 | Issue、Memory Problem、`test run` 取 red 与 green、`memory resolve`、`issue close` | Issue、提交回归测试、提交修复、`issue close --fixed` |
| 记录经验 | `memory add`、`memory activate` | 直接创建 `memory/<id>.md` |
| 采用方向 | `roadmap adopt` | `roadmap adopt` |
| 裁决设计 | `design decide` | `design decide` |
