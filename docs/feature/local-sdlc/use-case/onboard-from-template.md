---
format: concord.document/v1
id: onboard-from-template
title: 接入并取得模板
createdAt: 2026-09-13T11:00:33.375Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 接入并取得模板

## 用户目标

第一次接入 Concord 的维护者要在一个 Git 仓库里得到项目配置、文档目录和写作模板，然后开始写契约。整个过程不需要外部 checkout、服务或凭据。

## 起始状态

- 当前目录是 Git worktree 顶层，还没有 `concord.config.ts`。
- Concord 已安装，`concord --version` 可用。

## 完整路径

1. 预览要创建的文件。 {#preview}

   ```sh
   concord --dry-run init
   ```

   ```text
   Would apply init:
     concord.config.ts
     docs/constitution.md
     docs/concord.md
     docs/_template/feature-design/README.md
     ...
   ```

   预览不写文件，也不在 `.git` 下创建私有状态。

2. 初始化。 {#init}

   ```sh
   concord init --test-root test --source-root src
   ```

   人读输出列出全部创建的文件，最后三行给出下一步：

   ```text
   Start here: docs/concord.md
   Next: concord feature create <id> --title "Your feature"
   Inspect configuration: concord doctor
   ```

   创建的内容：

   - 配置与宪法：`concord.config.ts`、`docs/constitution.md`（draft）。
   - 入口与说明：`docs/concord.md`、`docs/README.md`、`docs/concepts.md`、`docs/architecture.md`。
   - 术语与写作政策：空的 `docs/concepts.json`、预设的 `docs/concord-writing.json`。
   - 模板与目录：`docs/_template/`、各分类目录的 README。
   - `AGENTS.md` 中的 Concord 区块。

3. 查看接入缺口。 {#doctor}

   ```sh
   concord --json doctor
   ```

   结果列出 `configuration`、`missingTestRoots`、`missingSourceRoots`、`documents`、`cases`、`codeDeclarations`、`findings` 与 `nextSteps`。`doctor` 不运行测试。完整字段见 [CLI](../cli.md#接入)。

4. 读取 Agent 指引。 {#skill}

   ```sh
   concord --skill
   concord --skill document
   ```

   `concord --skill` 输出入口、主题列表、设计理由和工作原则。`--skill <topic>` 输出一个主题，`--skill all` 输出全部主题。

## 结果

仓库得到一套可编辑的文档结构。下一步用 `concord feature create` 写第一份契约。

`init` 拒绝时退出 1，不写任何文件：

| 错误 | 触发条件 |
| --- | --- |
| `ProjectExists` | `concord.config.ts` 已存在 |
| `InitializationConflict` | 任一待创建文件已存在，例如 `docs/concord.md` |
| `ConflictingOptions` | `--docs-only` 与 `--test-root` 同时出现 |
| `ProjectMigrationRequired` | 仓库里有旧的 `concord.json` |

```json
{"ok":false,"error":"InitializationConflict","message":"docs/concord.md already exists; no existing file will be overwritten"}
```

## 已有文件

- 已有的 `docs/README.md`、`docs/concepts.md`、`docs/architecture.md`、`docs/concepts.json` 与写作政策原样保留，不算冲突。
- `AGENTS.md` 只创建或刷新带边界标记的 Concord 区块，区块外的内容保留。
- Concord 区块和 `docs/concord.md` 把 Agent 引到当前安装版本的 `concord --skill`。

## 页面选择

Feature 只要求 README。`--pages` 从 `library`、`cli`、`architecture`、`lifecycle`、`use-case` 中选择附页，省略时用初始化时保存的项目默认，`--no-pages` 只建 README。README 的入口只链接选中的页面。Use Case 索引不创建叶子 Use Case。Engineering 从目标、机制、使用、验收四节开始，按主题加页。

## 纯文档仓库

没有测试的仓库用 `concord init --docs-only` 接入，配置保存 `testRoots: []`。`doctor` 不要求测试目录，也不建议伪造测试。以后有了真实测试，在 `concord.config.ts` 添加测试根即可。

`check` 通过只表示文档关系有效，不表示测试覆盖。

## 随包模板

`concord template list` 与 `concord template show <name> --title <title>` 在未初始化的目录也能使用。模板清单缺失或损坏时返回 `TemplateInventoryInvalid`。

## Agent 指引的边界

`concord --skill` 来自安装包，不读取消费仓库的配置。未知主题返回 `SkillTopicUnknown`，与其它参数混用返回 `SkillArgumentsInvalid`，两者都不写文件。

## 可执行 quick start

项目 README 提供从空 Git 仓库到第一次 `test run` 的完整命令：创建 Feature 与 Use Case、三种代码声明和一个真实 Node 测试。打包验收直接执行安装包内 README 的 quick start，核对 3 条实现声明、1 条测试、一次 `Command pass` 和按行定位结果。

## 契约来源

- 命令与输出：[CLI](../cli.md#接入)
- 项目配置格式：[项目接入](../../project-onboarding/README.md)
