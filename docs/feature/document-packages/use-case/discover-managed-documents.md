# 完整发现受管文档

## 用户目标

维护者打开一个消费仓库，想从 CLI 和 Web 看到其中全部当前格式的文档，并在某篇文档写错时知道是哪一篇、结果是否完整。

## 起始状态

- 项目已初始化，`docs/` 下有 Feature、Engineering、Roadmap、Design 与 Issue。
- Feature、Engineering 与 Roadmap 由目录与 README 的一级标题确定，Design 与 Issue 是单个文件；索引与模板保持各自的角色。

## 完整路径

1. 列出文档。 {#list}

   ```sh
   concord list
   ```

   ```text
   list
   documents:
     docs/feature/cart/README.md — cart (feature)
     docs/feature/购物车/README.md — 购物车 (feature)
     docs/feature/购物车/use-case/修改数量.md — 修改数量 (use-case)
     docs/issues/slow-check.md — 大仓库里检查变慢 (issue)
     memory/cache-lesson.md — 删除缓存后检查结论不变 (memory)
   ```

   发现读取当前配置与受管来源集合。Web 工作台显示同一份清单。

2. 查看一个 Feature 的页面。 {#pages}

   在 `docs/feature/购物车/` 下多放一个 `notes.md`，再运行：

   ```sh
   concord show 购物车
   ```

   ```text
   Pages:
     docs/feature/购物车/README.md [readme] 购物车
     docs/feature/购物车/notes.md [unknown] 笔记
     docs/feature/购物车/use-case/修改数量.md [use-case] 修改数量
   …
   complete: true
   findings:
     docs/feature/购物车/notes.md
       UnknownPageKind: Page kind is unknown: notes.md
   ```

   文档包内每个 Markdown 页面按[路径与识别](../../../document-model.md#路径与识别)得到页面种类。无法归类的页面照常被发现，种类为 `unknown`，可以阅读与编辑；`check` 报告 `UnknownPageKind`，见[页面种类检查](../../documentation-quality/cli.md#页面种类)。这类页面已经读到，不使结果不完整。

3. 检查一篇写错的文档。 {#invalid}

   新建 `docs/issues/broken.md`，正文没有一级标题，再运行：

   ```sh
   concord check
   ```

   ```text
   check
   ok: false
   complete: false
   findings:
     docs/issues/broken.md
       InvalidData: docs/issues/broken.md: expected exactly one single-line level-one heading (at most 1024 characters)
   …
   ```

   finding 给出出错的路径，结果标为不完整。Concord 不改动 `broken.md`。

4. 写错一篇文档时照常列出其余文档。 {#partial-list}

   `broken.md` 还在，运行：

   ```sh
   concord --json list issue
   ```

   以下为预期输出：

   ```json
   {"operation":"list","documents":[{"path":"docs/issues/slow-check.md","id":"slow-check","title":"大仓库里检查变慢","digest":"sha256:…","provider":"local"}],"complete":false,"findings":[{"code":"InvalidData","path":"docs/issues/broken.md","message":"docs/issues/broken.md: expected exactly one single-line level-one heading (at most 1024 characters)"}]}
   ```

   命令以 0 退出：清单本身读到了，`complete: false` 与 `findings` 说明哪篇没有读成。所有文档都读成时 `complete` 为 `true`、`findings` 为 `[]`。按类别列出时只扫描该类别的位置，写错的 Issue 不使 `concord list memory` 不完整。`issue index` 与 `memory index`（Web 的 Issue 与 Memory 列表使用它们）给出同样的 `complete` 与 `findings`，各自的 `operation` 与条目字段不变。

## 结果

| 情形 | 看到什么 |
| --- | --- |
| 当前格式的全部文档 | CLI 与 Web 都完整发现，清单一致；两者共用同一套发现与解析，Web 页面另外显示的检查结果不属于清单 |
| 文档格式无效 | 带路径的 finding，结果标为不完整；不猜测已采用或已裁决的状态，不转换或重写原文件 |
| 列表中有一篇文档格式无效 | 其余文档照常列出，`complete: false`，`findings` 给出 `InvalidData` 或 `InvalidPlacement` 与路径，退出 0 |
| 文件无法读取、路径不安全或有未完成的写入需要恢复 | 整个命令以对应错误失败，不给出部分清单 |
| `memory search`、`issue search`、按短 ID 选择文档的命令遇到写错的文档 | 行为不变：仍以错误失败，避免在不完整的集合上选错目标 |
| 包内页面的文件名不是已知种类 | 照常发现，种类为 `unknown`；`check` 报告 `UnknownPageKind`，结果仍完整 |
| owner 目录嵌套在另一个 owner 之内 | 嵌套 owner 截断祖先的归属，其中的材料仍可从目录树访问 |
| 运行结构检查 | 只检查文档结构，不产生测试执行证据 |
